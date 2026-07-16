import { useCallback, useEffect, useState, useMemo } from 'react';
import { Alert, Button, Form, Input, Modal, Spin, Tag, message, Collapse, Radio, Switch, Table } from 'antd';
import { DisconnectOutlined, ReloadOutlined, SettingOutlined } from '@ant-design/icons';

import { HttpUtil } from '@/utils';
import './VPNGateModal.css';

interface VPNGateModalProps {
  open: boolean;
  onClose: () => void;
  outbounds?: Record<string, any>[];
  routing?: Record<string, any>;
  onConfirm?: () => void;
}

interface VPNGateOverview {
  connected: boolean;
  connecting: boolean;
  autoConnect: boolean;
  country: string;
  ip: string;
  latency: number | string | null;
  ipType: string;
  asn: string;
  availableNodes: number;
  totalNodes: number;
  failedNodes: number;
  message: string;
  nodes?: Array<Record<string, any>>;
  state?: Record<string, any>;
}

const EMPTY: VPNGateOverview = {
  connected: false, connecting: false, autoConnect: true, country: '', ip: '', latency: null,
  ipType: '', asn: '', availableNodes: 0, totalNodes: 0, failedNodes: 0, message: '',
};

export default function VPNGateModal({ open, onClose, outbounds, routing, onConfirm }: VPNGateModalProps) {
  const [data, setData] = useState<VPNGateOverview>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  // 高级设置展示状态
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [form] = Form.useForm<{ host: string; port: number; inboundTags: string }>();
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ reachable: boolean; error?: string } | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const result = await HttpUtil.get<VPNGateOverview>('/panel/vpngate/overview', undefined, { silent: true });
      if (!result.success) throw new Error(result.msg || '无法读取 VPNGate 状态');
      setData(result.obj || EMPTY);
    } catch (err) {
      if (!silent) messageApi.error(err instanceof Error ? err.message : '无法读取 VPNGate 状态');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [messageApi]);

  useEffect(() => {
    if (!open) return;
    void load();
    const timer = window.setInterval(() => void load(true), 5000); // 提频至 5s 一次轮询以提升响应速度
    return () => window.clearInterval(timer);
  }, [open, load]);

  // 当打开 modal 或外层 outbounds/routing 变化时，初始化高级表单数值
  useEffect(() => {
    if (!open) return;
    const vpOutbound = outbounds?.find((o) => o.tag === 'vpngate');
    const server = vpOutbound?.settings?.servers?.[0];
    const initialHost = server?.address || '127.0.0.1';
    const initialPort = server?.port || 7928;

    const vpRule = routing?.rules?.find((r: any) => r.outboundTag === 'vpngate');
    const initialInboundTags = Array.isArray(vpRule?.inboundTag)
      ? vpRule.inboundTag.join(', ')
      : (vpRule?.inboundTag || '');

    form.setFieldsValue({
      host: initialHost,
      port: initialPort,
      inboundTags: initialInboundTags,
    });
    setTestResult(null);
  }, [open, outbounds, routing, form]);

  async function action(path: 'refresh' | 'disconnect') {
    setActionLoading(true);
    try {
      const result = await HttpUtil.post(`/panel/vpngate/${path}`, {}, { silent: true });
      if (!result.success) throw new Error(result.msg || '操作失败');
      messageApi.success(path === 'refresh' ? '已开始重新获取 VPNGate 节点' : 'VPNGate 连接已关闭');
      window.setTimeout(() => void load(true), 700);
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setActionLoading(false);
    }
  }

  // 固定连接到指定节点
  async function connectNode(id: string) {
    setActionLoading(true);
    try {
      const result = await HttpUtil.post('/panel/vpngate/connect', { id }, { silent: true });
      if (!result.success) throw new Error(result.msg || '连接节点失败');
      messageApi.success('正在请求连接指定节点，请稍候...');
      window.setTimeout(() => void load(true), 2000);
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '连接节点失败');
    } finally {
      setActionLoading(false);
    }
  }

  // 切换自动连接与固定连接的路由模式
  async function changeRoutingMode(mode: 'auto' | 'fixed_ip') {
    setActionLoading(true);
    try {
      const country = data.state?.force_country || '';
      const ipType = data.state?.routing_ip_type || 'all';
      const result = await HttpUtil.post('/panel/vpngate/update_routing', {
        routing_mode: mode,
        force_country: country,
        routing_ip_type: ipType,
      }, { silent: true });
      if (!result.success) throw new Error(result.msg || '路由模式更新失败');
      messageApi.success(`已成功切换为：${mode === 'auto' ? '自动连接' : '固定连接'}模式`);
      window.setTimeout(() => void load(true), 800);
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '切换路由模式失败');
    } finally {
      setActionLoading(false);
    }
  }

  // 自动切换开关逻辑（控制开启连接/断开连接）
  async function toggleConnectionEnabled(checked: boolean) {
    setActionLoading(true);
    try {
      if (checked) {
        const result = await HttpUtil.post('/panel/vpngate/refresh', {}, { silent: true });
        if (!result.success) throw new Error(result.msg);
        messageApi.success('自动切换已开启');
      } else {
        const result = await HttpUtil.post('/panel/vpngate/disconnect', {}, { silent: true });
        if (!result.success) throw new Error(result.msg);
        messageApi.success('自动切换已关闭');
      }
      window.setTimeout(() => void load(true), 800);
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '切换连接状态失败');
    } finally {
      setActionLoading(false);
    }
  }

  // 按国家对节点进行前端 Group By 聚合
  const countryGroups = useMemo(() => {
    const groups: Record<string, { nodes: any[]; count: number }> = {};
    (data.nodes || []).forEach((node) => {
      const country = node.country || node.location || 'Unknown';
      if (!groups[country]) {
        groups[country] = { nodes: [], count: 0 };
      }
      groups[country].nodes.push(node);
      if (node.probe_status === 'available') {
        groups[country].count++;
      }
    });
    return Object.entries(groups)
      .sort((a, b) => b[1].nodes.length - a[1].nodes.length)
      .map(([name, item]) => ({
        name,
        nodes: item.nodes,
        totalCount: item.nodes.length,
        availableCount: item.count,
      }));
  }, [data.nodes]);

  // 测试本地 Aimili VPN 代理连接
  async function testConnection() {
    try {
      setTestLoading(true);
      const v = await form.validateFields();
      const payload = {
        host: v.host,
        port: v.port,
        inboundTags: JSON.stringify(
          v.inboundTags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean)
        ),
      };
      const msg = await HttpUtil.post<{ reachable: boolean; error?: string }>('/panel/vpngate/status', payload);
      if (!msg.success) throw new Error(msg.msg);
      setTestResult(msg.obj ?? null);
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '无法检查 AimiliVPN 本地代理');
    } finally {
      setTestLoading(false);
    }
  }

  // 保存 VPNGate 出站和路由配置
  async function saveConfig() {
    try {
      setActionLoading(true);
      const v = await form.validateFields();
      const payload = {
        host: v.host,
        port: v.port,
        inboundTags: JSON.stringify(
          v.inboundTags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean)
        ),
      };
      const msg = await HttpUtil.post('/panel/vpngate/apply', payload);
      if (!msg.success) throw new Error(msg.msg);
      messageApi.success('VPNGate 出站已保存，Xray 将自动重载');
      window.setTimeout(() => {
        window.location.reload();
      }, 1000);
      onClose();
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '保存 VPNGate 出站失败');
    } finally {
      setActionLoading(false);
    }
  }

  const status = data.connecting ? '连接中' : data.connected ? '已连接' : '未连接';
  const statusColor = data.connecting ? 'processing' : data.connected ? 'success' : 'default';
  const latency = data.latency == null || data.latency === '' ? '—' : `${data.latency} ms`;

  // 定义节点 Table 表格列
  const columns = [
    { title: '国家', dataIndex: 'country', key: 'country', render: (val: string, record: any) => val || record.location || '—' },
    { title: '延迟', dataIndex: 'latency_ms', key: 'latency', render: (val: any) => val == null ? '—' : `${val} ms` },
    { title: 'IP 类型', dataIndex: 'ip_type', key: 'ipType', render: (val: string) => val === 'residential' ? '住宅IP' : val === 'hosting' ? '机房IP' : val || '—' },
    { title: 'ASN', dataIndex: 'asn', key: 'asn' },
    { title: '节点 IP', dataIndex: 'ip', key: 'ip' },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => {
        const isActive = record.active === true || record.id === data.state?.active_openvpn_node_id;
        return (
          <Button
            size="small"
            type={isActive ? 'primary' : 'default'}
            danger={isActive}
            loading={actionLoading}
            onClick={() => {
              if (isActive) {
                void action('disconnect');
              } else {
                void connectNode(record.id);
              }
            }}
          >
            {isActive ? '断开' : '连接'}
          </Button>
        );
      }
    }
  ];

  return (
    <Modal open={open} title="VPNGate" onCancel={onClose} footer={null} width={800} destroyOnHidden>
      {contextHolder}
      <Spin spinning={loading}>
        <section className="vpngate-panel">
          <div className="vpngate-head">
            <div>当前状态　<Tag color={statusColor}>{status}</Tag>　<Tag>{data.autoConnect ? '自动连接' : '已暂停自动连接'}</Tag></div>
            <div className="vpngate-actions">
              <Button icon={<ReloadOutlined />} loading={actionLoading} onClick={() => action('refresh')}>重新获取</Button>
              <Button danger icon={<DisconnectOutlined />} loading={actionLoading} disabled={!data.connected && !data.connecting} onClick={() => action('disconnect')}>关闭连接</Button>
            </div>
          </div>

          {data.connected || data.connecting ? (
            <>
              <h2>{data.country || '正在选择节点'}</h2>
              <div className="vpngate-ip">{data.ip || '—'}</div>
              <div className="vpngate-stats">
                <Metric label="延迟" value={latency} accent />
                <Metric label="IP 类型" value={data.ipType === 'residential' ? '住宅IP' : data.ipType === 'hosting' ? '机房IP' : data.ipType || '—'} />
                <Metric label="ASN" value={data.asn || '—'} />
                <Metric label="可用节点" value={data.availableNodes} />
                <Metric label="全部节点" value={data.totalNodes} />
                <Metric label="失效节点" value={data.failedNodes} />
              </div>
            </>
          ) : (
            <Alert type="warning" showIcon title="VPNGate 暂未建立连接" description={data.message || '请先重新获取节点，服务会自动选择可用节点。'} />
          )}
          {data.message && (data.connected || data.connecting) && <div className="vpngate-message">{data.message}</div>}
          
          <div className="vpngate-foot">
            <Button icon={<SettingOutlined />} onClick={() => setShowAdvanced(!showAdvanced)}>
              {showAdvanced ? '关闭高级' : '开启高级'}
            </Button>
          </div>

          {showAdvanced && (
            <div className="vpngate-advanced">
              {/* 第一级高级控制：连接模式与自动切换 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  连接模式　
                  <Radio.Group
                    value={data.state?.routing_mode || 'auto'}
                    onChange={(e) => void changeRoutingMode(e.target.value as 'auto' | 'fixed_ip')}
                    optionType="button"
                    buttonStyle="solid"
                  >
                    <Radio.Button value="auto">自动连接</Radio.Button>
                    <Radio.Button value="fixed_ip">固定连接</Radio.Button>
                  </Radio.Group>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>自动切换</span>
                  <Switch
                    checked={data.state?.connection_enabled === true}
                    onChange={(checked) => void toggleConnectionEnabled(checked)}
                    loading={actionLoading}
                  />
                </div>
              </div>

              {/* 国家折叠列表 */}
              {countryGroups.length > 0 ? (
                <Collapse size="small" style={{ marginBottom: 16 }}>
                  {countryGroups.map((g) => (
                    <Collapse.Panel header={`${g.name} (${g.totalCount})`} key={g.name}>
                      <Table
                        size="small"
                        dataSource={g.nodes}
                        rowKey="id"
                        pagination={false}
                        columns={columns}
                      />
                    </Collapse.Panel>
                  ))}
                </Collapse>
              ) : (
                <Alert type="info" message="暂无可用节点列表，请先点击「重新获取」" className="mb-16" showIcon />
              )}

              {/* 第二级折叠：Xray 底层出站对接设置 */}
              <Collapse size="small" className="vpngate-xray-settings">
                <Collapse.Panel header="出站对接设置 (Xray 本地 SOCKS)" key="xray">
                  <Form form={form} layout="vertical" className="vpngate-form">
                    <div className="form-row">
                      <Form.Item name="host" label="本地代理地址" rules={[{ required: true }]} style={{ flex: 1 }}>
                        <Input />
                      </Form.Item>
                      <Form.Item name="port" label="本地 SOCKS5 端口" rules={[{ required: true }]} style={{ flex: 1 }}>
                        <Input type="number" />
                      </Form.Item>
                    </div>
                    <Form.Item name="inboundTags" label="走 VPNGate 的入站标签（逗号分隔，可留空）">
                      <Input placeholder="例如：vless-reality, trojan" />
                    </Form.Item>
                  </Form>
                  {testResult && (
                    <Alert
                      type={testResult.reachable ? 'success' : 'error'}
                      title={testResult.reachable ? '本地代理连接正常' : testResult.error}
                      className="mb-16"
                      showIcon
                    />
                  )}
                  <div className="vpngate-advanced-actions">
                    <Button onClick={testConnection} loading={testLoading}>检查连接</Button>
                    <Button type="primary" onClick={saveConfig} loading={actionLoading} style={{ marginLeft: 8 }}>
                      保存配置
                    </Button>
                  </div>
                </Collapse.Panel>
              </Collapse>
            </div>
          )}
        </section>
      </Spin>
    </Modal>
  );
}

function Metric({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return <div className="vpngate-metric"><span>{label}</span><strong className={accent ? 'accent' : ''}>{value}</strong></div>;
}

import { useState } from 'react';
import { Alert, Button, Form, Input, Modal, message } from 'antd';

import { HttpUtil } from '@/utils';

interface VPNGateModalProps {
  open: boolean;
  onClose: () => void;
}

interface VPNGateStatus {
  host: string;
  port: number;
  reachable: boolean;
  error?: string;
}

export default function VPNGateModal({ open, onClose }: VPNGateModalProps) {
  const [form] = Form.useForm<{ host: string; port: number; inboundTags: string }>();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<VPNGateStatus | null>(null);

  const values = () => form.validateFields();
  const payload = (v: { host: string; port: number; inboundTags: string }) => ({
    host: v.host,
    port: v.port,
    inboundTags: JSON.stringify(v.inboundTags.split(',').map((tag) => tag.trim()).filter(Boolean)),
  });

  async function testConnection() {
    try {
      setLoading(true);
      const msg = await HttpUtil.post<VPNGateStatus>('/panel/vpngate/status', payload(await values()));
      if (!msg.success) throw new Error(msg.msg);
      setStatus(msg.obj ?? null);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '无法检查 AimiliVPN 本地代理');
    } finally {
      setLoading(false);
    }
  }

  async function apply() {
    try {
      setLoading(true);
      const msg = await HttpUtil.post('/panel/vpngate/apply', payload(await values()));
      if (!msg.success) throw new Error(msg.msg);
      message.success('VPNGate 出站已保存，Xray 将自动重载');
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存 VPNGate 出站失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} title="AimiliVPN / VPNGate 出站" onCancel={onClose} footer={null} destroyOnHidden>
      <Alert
        type="info"
        showIcon
        className="mb-16"
        title="AimiliVPN 必须先在本机启动；代理地址只允许使用本机回环地址。"
      />
      <Form form={form} layout="vertical" initialValues={{ host: '127.0.0.1', port: 7928, inboundTags: '' }}>
        <Form.Item name="host" label="本地代理地址" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="port" label="本地 SOCKS5 端口" rules={[{ required: true }]}>
          <Input type="number" />
        </Form.Item>
        <Form.Item name="inboundTags" label="走 VPNGate 的入站标签（逗号分隔，可留空）">
          <Input placeholder="例如：vless-reality, trojan" />
        </Form.Item>
      </Form>
      {status && <Alert type={status.reachable ? 'success' : 'error'} title={status.reachable ? '本地代理连接正常' : status.error} className="mb-16" />}
      <Button onClick={testConnection} loading={loading}>检查连接</Button>
      <Button type="primary" onClick={apply} loading={loading} className="ml-8">保存出站</Button>
    </Modal>
  );
}

package service

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/mhsanaei/3x-ui/v3/util/common"
)

// VPNGateService manages the small Xray-side adapter for AimiliVPN.  Aimili
// remains a separate process: it owns OpenVPN/TUN and exposes a loopback
// SOCKS5 listener, while Xray sends selected inbound traffic to that listener.
type VPNGateService struct {
	SettingService     SettingService
	XraySettingService XraySettingService
}

type VPNGateStatus struct {
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Reachable bool   `json:"reachable"`
	Error     string `json:"error,omitempty"`
}

// VPNGateOverview is the small, credential-free view rendered in the 3x-ui
// modal. The Aimili management password never leaves the server.
type VPNGateOverview struct {
	Connected          bool   `json:"connected"`
	Connecting         bool   `json:"connecting"`
	AutoConnect        bool   `json:"autoConnect"`
	Country            string `json:"country"`
	IP                 string `json:"ip"`
	Latency            any    `json:"latency"`
	IPType             string `json:"ipType"`
	ASN                string `json:"asn"`
	AvailableNodes     int    `json:"availableNodes"`
	TotalNodes         int    `json:"totalNodes"`
	FailedNodes        int    `json:"failedNodes"`
	Message            string `json:"message"`
}

type vpnGateUIConfig struct {
	Username   string `json:"username"`
	Password   string `json:"password"`
	SecretPath string `json:"secret_path"`
	Port       int    `json:"port"`
	Enabled    bool   `json:"connection_enabled"`
}

func vpnGateDataDir() string {
	if dir := strings.TrimSpace(os.Getenv("VPNGATE_DATA_DIR")); dir != "" {
		return dir
	}
	return "/opt/3x-ui-vpngate/third_party/aimili-vpngate/vpngate_data"
}

func (s *VPNGateService) managerRequest(method, apiPath string, payload any, result any) error {
	raw, err := os.ReadFile(vpnGateDataDir() + "/ui_auth.json")
	if err != nil {
		return common.NewError("VPNGate is not initialized yet")
	}
	var cfg vpnGateUIConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return common.NewError("VPNGate management configuration is invalid")
	}
	if cfg.Port < 1 || cfg.Port > 65535 || cfg.Username == "" || cfg.Password == "" || strings.ContainsAny(cfg.SecretPath, "/\\") {
		return common.NewError("VPNGate management configuration is incomplete")
	}
	base := fmt.Sprintf("http://127.0.0.1:%d/%s/api/", cfg.Port, cfg.SecretPath)
	loginBody, _ := json.Marshal(map[string]string{"username": cfg.Username, "password": cfg.Password})
	client := &http.Client{Timeout: 8 * time.Second}
	login, err := http.NewRequest(http.MethodPost, base+"login", bytes.NewReader(loginBody))
	if err != nil { return err }
	login.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(login)
	if err != nil { return common.NewError("VPNGate local service is unavailable") }
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK { return common.NewError("VPNGate local authentication failed") }
	var session string
	for _, cookie := range resp.Cookies() { if cookie.Name == "session" { session = cookie.Value; break } }
	if session == "" { return common.NewError("VPNGate local session was not created") }

	var body io.Reader
	if payload != nil { encoded, _ := json.Marshal(payload); body = bytes.NewReader(encoded) }
	req, err := http.NewRequest(method, base+apiPath, body)
	if err != nil { return err }
	req.AddCookie(&http.Cookie{Name: "session", Value: session})
	if payload != nil { req.Header.Set("Content-Type", "application/json") }
	resp, err = client.Do(req)
	if err != nil { return common.NewError("VPNGate local request failed") }
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 { return common.NewErrorf("VPNGate request failed: %s", strings.TrimSpace(string(data))) }
	if result != nil && len(data) > 0 { return json.Unmarshal(data, result) }
	return nil
}

// Overview reads the active VPNGate node through its loopback-only management API.
func (s *VPNGateService) Overview() (*VPNGateOverview, error) {
	var data struct { Nodes []map[string]any `json:"nodes"`; State map[string]any `json:"state"` }
	if err := s.managerRequest(http.MethodGet, "nodes", nil, &data); err != nil { return nil, err }
	o := &VPNGateOverview{AutoConnect: true, Message: fmt.Sprint(data.State["last_check_message"])}
	if enabled, ok := data.State["connection_enabled"].(bool); ok { o.AutoConnect = enabled }
	if connecting, ok := data.State["is_connecting"].(bool); ok { o.Connecting = connecting }
	for _, node := range data.Nodes {
		o.TotalNodes++
		if node["probe_status"] == "available" { o.AvailableNodes++ }
		if node["probe_status"] == "unavailable" { o.FailedNodes++ }
		if node["active"] != true { continue }
		o.Connected = true
		o.Country, _ = node["country"].(string); if o.Country == "" { o.Country, _ = node["location"].(string) }
		o.IP, _ = node["ip"].(string); if o.IP == "" { o.IP, _ = node["remote_host"].(string) }
		o.Latency = node["latency_ms"]
		o.IPType, _ = node["ip_type"].(string)
		o.ASN, _ = node["asn"].(string)
	}
	return o, nil
}

func (s *VPNGateService) Refresh() error { var out map[string]any; return s.managerRequest(http.MethodPost, "refresh_nodes", map[string]any{}, &out) }
func (s *VPNGateService) Disconnect() error { var out map[string]any; return s.managerRequest(http.MethodPost, "disconnect", map[string]any{}, &out) }

func validateVPNGateEndpoint(host string, port int) error {
	host = strings.TrimSpace(host)
	if host != "127.0.0.1" && host != "::1" && host != "localhost" {
		return common.NewError("VPNGate proxy must use a loopback address")
	}
	if port < 1024 || port > 65535 {
		return common.NewError("VPNGate proxy port must be between 1024 and 65535")
	}
	return nil
}

func (s *VPNGateService) Status(host string, port int) (*VPNGateStatus, error) {
	if err := validateVPNGateEndpoint(host, port); err != nil {
		return nil, err
	}
	status := &VPNGateStatus{Host: host, Port: port}
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, strconv.Itoa(port)), 2*time.Second)
	if err != nil {
		status.Error = err.Error()
		return status, nil
	}
	_ = conn.Close()
	status.Reachable = true
	return status, nil
}

// Apply writes a socks outbound named vpngate and, if inboundTags is nonempty,
// a routing rule that sends only those inbounds through AimiliVPN.
func (s *VPNGateService) Apply(host string, port int, inboundTags []string) error {
	if err := validateVPNGateEndpoint(host, port); err != nil {
		return err
	}
	raw, err := s.SettingService.GetXrayConfigTemplate()
	if err != nil {
		return err
	}
	var config map[string]any
	if err := json.Unmarshal([]byte(raw), &config); err != nil {
		return fmt.Errorf("read Xray template: %w", err)
	}

	outbounds, _ := config["outbounds"].([]any)
	outbound := map[string]any{
		"tag": "vpngate", "protocol": "socks",
		"settings": map[string]any{"servers": []any{map[string]any{"address": host, "port": port}}},
	}
	found := false
	for i, item := range outbounds {
		if current, ok := item.(map[string]any); ok && current["tag"] == "vpngate" {
			outbounds[i] = outbound
			found = true
			break
		}
	}
	if !found {
		outbounds = append(outbounds, outbound)
	}
	config["outbounds"] = outbounds

	clean := make([]any, 0, len(inboundTags))
	seen := map[string]bool{}
	for _, tag := range inboundTags {
		tag = strings.TrimSpace(tag)
		if tag != "" && !seen[tag] {
			clean, seen[tag] = append(clean, tag), true
		}
	}
	routing, _ := config["routing"].(map[string]any)
	if routing == nil {
		routing = map[string]any{}
	}
	rules, _ := routing["rules"].([]any)
	filtered := make([]any, 0, len(rules)+1)
	for _, rule := range rules {
		// The adapter owns rules pointing to its reserved outbound tag.
		if m, ok := rule.(map[string]any); ok && m["outboundTag"] == "vpngate" {
			continue
		}
		filtered = append(filtered, rule)
	}
	if len(clean) > 0 {
		filtered = append(filtered, map[string]any{"type": "field", "inboundTag": clean, "outboundTag": "vpngate"})
	}
	routing["rules"] = filtered
	config["routing"] = routing

	updated, err := json.Marshal(config)
	if err != nil {
		return err
	}
	return s.XraySettingService.SaveXraySetting(string(updated))
}

package service

import (
	"encoding/json"
	"fmt"
	"net"
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

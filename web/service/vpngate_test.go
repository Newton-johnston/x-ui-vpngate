package service

import "testing"

func TestValidateVPNGateEndpoint(t *testing.T) {
	valid := []string{"127.0.0.1", "::1", "localhost"}
	for _, host := range valid {
		if err := validateVPNGateEndpoint(host, 7928); err != nil {
			t.Fatalf("expected %q to be accepted: %v", host, err)
		}
	}
	for _, host := range []string{"0.0.0.0", "10.0.0.2", "example.com"} {
		if err := validateVPNGateEndpoint(host, 7928); err == nil {
			t.Fatalf("expected %q to be rejected", host)
		}
	}
	if err := validateVPNGateEndpoint("127.0.0.1", 80); err == nil {
		t.Fatal("expected privileged port to be rejected")
	}
}

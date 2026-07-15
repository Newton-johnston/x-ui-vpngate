package controller

import (
	"encoding/json"
	"strconv"

	"github.com/mhsanaei/3x-ui/v3/util/common"
	"github.com/mhsanaei/3x-ui/v3/web/service"
	"github.com/gin-gonic/gin"
)

// VPNGateController exposes the Xray-to-Aimili adapter. It intentionally does
// not proxy Aimili's management UI or credentials through the panel.
type VPNGateController struct {
	service service.VPNGateService
	xray    service.XrayService
}

func NewVPNGateController(g *gin.RouterGroup) *VPNGateController {
	a := &VPNGateController{}
	g = g.Group("/vpngate")
	g.POST("/status", a.status)
	g.POST("/apply", a.apply)
	return a
}

func (a *VPNGateController) endpoint(c *gin.Context) (string, int, error) {
	host := c.DefaultPostForm("host", "127.0.0.1")
	port, err := strconv.Atoi(c.DefaultPostForm("port", "7928"))
	if err != nil {
		return "", 0, common.NewError("invalid VPNGate proxy port")
	}
	return host, port, nil
}

func (a *VPNGateController) status(c *gin.Context) {
	host, port, err := a.endpoint(c)
	if err != nil {
		jsonObj(c, nil, err)
		return
	}
	result, err := a.service.Status(host, port)
	jsonObj(c, result, err)
}

func (a *VPNGateController) apply(c *gin.Context) {
	host, port, err := a.endpoint(c)
	if err != nil {
		jsonObj(c, nil, err)
		return
	}
	var tags []string
	if raw := c.PostForm("inboundTags"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &tags); err != nil {
			jsonObj(c, nil, common.NewError("inboundTags must be a JSON array"))
			return
		}
	}
	if err := a.service.Apply(host, port, tags); err != nil {
		jsonObj(c, nil, err)
		return
	}
	a.xray.SetToNeedRestart()
	jsonObj(c, map[string]any{"outboundTag": "vpngate", "restartScheduled": true}, nil)
}

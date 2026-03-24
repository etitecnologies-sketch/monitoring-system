FROM alpine:latest
RUN apk add --no-cache tailscale ca-certificates iptables ip6tables
COPY start.sh /start.sh
RUN chmod +x /start.sh
CMD ["/start.sh"]

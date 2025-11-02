# RiTerm TCP Forwarding Examples

This document provides examples of using RiTerm's TCP forwarding capabilities to expose local TCP services through P2P connections.

## Overview

RiTerm TCP forwarding allows you to:
- Expose local TCP services (like web servers, databases, APIs) to remote peers
- Create secure P2P tunnels for TCP traffic
- Access services behind NAT/firewall without port forwarding
- Share development services with team members securely

## Basic Usage

### 1. Listen on Local TCP and Forward to Remote

Expose a local web server running on port 3000:

```bash
# Start TCP forwarding for a local web server
./cli riterm-quic listen-tcp 0.0.0.0:3000 --remote-host localhost --remote-port 3000 --qr

# Output:
# 🔗 === TCP FORWARDING TICKET ===
# TF_ABC123... (compressed ticket)
# =================================
#
# 📱 QR Code will be displayed if --qr flag is used
```

### 2. Connect to Remote TCP Forwarding Service

Connect to a remote TCP forwarding service:

```bash
# Connect using the ticket
./cli riterm-quic connect-tcp TF_ABC123...

# Output:
# ✅ Connected to TCP forwarding service
# 💡 TCP forwarding is active
# 💡 Local services are accessible through the P2P connection
```

## Advanced Examples

### Forwarding a Development Web Server

**Host (Machine A):**
```bash
# Expose local React dev server
./cli riterm-quic listen-tcp 127.0.0.1:3000 \
  --remote-host localhost \
  --remote-port 3000 \
  --qr \
  --output dev-server-ticket.txt
```

**Client (Machine B):**
```bash
# Connect to the development server
./cli riterm-quic connect-tcp "$(cat dev-server-ticket.txt)" \
  --local-addr 127.0.0.1:8080

# Now access http://localhost:8080 on Machine B to see the dev server
```

### Forwarding a Database Connection

**Host (Machine A with PostgreSQL):**
```bash
# Expose PostgreSQL database
./cli riterm-quic listen-tcp 127.0.0.1:5432 \
  --remote-host localhost \
  --remote-port 5432 \
  --qr
```

**Client (Machine B):**
```bash
# Connect to the remote database
./cli riterm-quic connect-tcp TF_POSTGRES_TICKET... \
  --local-addr 127.0.0.1:15432

# Connect with psql:
# psql -h localhost -p 15432 -U username -d database
```

### Forwarding an API Service

**Host (Machine A with API):**
```bash
# Expose REST API
./cli riterm-quic listen-tcp 0.0.0.0:8080 \
  --remote-host api.local \
  --remote-port 8080 \
  --output api-ticket.txt
```

**Client (Machine B):**
```bash
# Connect to API
./cli riterm-quic connect-tcp "$(cat api-ticket.txt)" \
  --local-addr 127.0.0.1:9090

# Test the API:
# curl http://localhost:9090/api/health
```

## Command Reference

### listen-tcp

Start listening on local TCP and forward to remote peer.

```bash
./cli riterm-quic listen-tcp <LOCAL_ADDR> [OPTIONS]
```

**Arguments:**
- `<LOCAL_ADDR>`: Local address to bind (e.g., `0.0.0.0:8080`, `127.0.0.1:3000`)

**Options:**
- `--remote-host <HOST>`: Remote host to connect to (optional)
- `--remote-port <PORT>`: Remote port to connect to (optional)
- `--qr`: Generate QR code for the ticket
- `--output <FILE>`: Save ticket to file

**Examples:**
```bash
# Basic usage
./cli riterm-quic listen-tcp 0.0.0.0:8080

# With remote host specification
./cli riterm-quic listen-tcp 127.0.0.1:5432 \
  --remote-host localhost \
  --remote-port 5432

# Generate QR code
./cli riterm-quic listen-tcp 0.0.0.0:3000 --qr

# Save ticket to file
./cli riterm-quic listen-tcp 127.0.0.1:8080 \
  --output my-service-ticket.txt
```

### connect-tcp

Connect to a remote TCP forwarding service.

```bash
./cli riterm-quic connect-tcp <TICKET> [OPTIONS]
```

**Arguments:**
- `<TICKET>`: TCP forwarding ticket from `listen-tcp` command

**Options:**
- `--local-addr <ADDR>`: Local address to bind for incoming connections (default: `127.0.0.1:0`)

**Examples:**
```bash
# Connect with ticket
./cli riterm-quic connect-tcp TF_ABC123...

# Specify local bind address
./cli riterm-quic connect-tcp TF_ABC123... \
  --local-addr 127.0.0.1:8080

# Connect using ticket from file
./cli riterm-quic connect-tcp "$(cat ticket.txt)"
```

## Use Cases

### 1. Development Collaboration

Share your local development server with team members without deploying:

```bash
# Developer 1: Expose local dev server
./cli riterm-quic listen-tcp 127.0.0.1:3000 --qr

# Developer 2: Scan QR and connect
./cli riterm-quic connect-tcp TF_DEV_SERVER_TICKET...
# Now access http://localhost:8080 to see Developer 1's app
```

### 2. Remote Database Access

Access databases behind corporate firewall:

```bash
# Office server: Expose database
./cli riterm-quic listen-tcp 127.0.0.1:5432 --qr

# Home developer: Connect to database
./cli riterm-quic connect-tcp TF_DB_TICKET... --local-addr 127.0.0.1:15432
```

### 3. API Testing

Test local APIs from mobile devices or other machines:

```bash
# Development machine: Expose API
./cli riterm-quic listen-tcp 0.0.0.0:8080 --qr

# Mobile device: Connect and test
./cli riterm-quic connect-tcp TF_API_TICKET...
# Use mobile browser/app to access http://localhost:8080
```

### 4. IoT Device Access

Access IoT device web interfaces from anywhere:

```bash
# IoT device: Expose web interface
./cli riterm-quic listen-tcp 0.0.0.0:80 --qr

# Remote access: Connect to device
./cli riterm-quic connect-tcp TF_IOT_TICKET...
```

## Security Considerations

### 1. Access Control

- TCP forwarding tickets are single-use tokens
- Tickets expire after session ends
- No persistent access remains after disconnection

### 2. Network Security

- All traffic is encrypted end-to-end via QUIC
- No open ports required on firewall/NAT
- P2P connection establishment uses secure hole punching

### 3. Service Exposure

- Only expose services you intend to share
- Consider using `127.0.0.1` instead of `0.0.0.0` for local-only access
- Monitor active connections in the logs

## Troubleshooting

### Connection Issues

1. **"Failed to parse ticket"**
   - Ensure the ticket is copied correctly
   - Check for extra whitespace or line breaks
   - Verify the ticket starts with `TF_`

2. **"Connection timeout"**
   - Check network connectivity
   - Ensure both peers can reach the relay server
   - Try again with a different relay URL

3. **"Address already in use"**
   - Choose a different local port
   - Check if another service is using the port
   - Use `127.0.0.1:0` for automatic port selection

### Performance Issues

1. **High latency**
   - Check relay server location
   - Try a different relay server closer to both peers
   - Ensure good network connectivity

2. **Slow throughput**
   - Check available bandwidth
   - Reduce concurrent connections
   - Monitor system resources

## Best Practices

### 1. Ticket Management

- Save tickets to files for reuse: `--output ticket.txt`
- Generate QR codes for easy sharing: `--qr`
- Use descriptive ticket file names

### 2. Port Selection

- Use standard ports for well-known services (80, 443, 5432, etc.)
- Use high-numbered ports for custom applications (8000-9999)
- Avoid conflicting with system services

### 3. Address Binding

- Use `127.0.0.1` for local-only access
- Use `0.0.0.0` to accept connections from other machines
- Consider security implications of public binding

### 4. Service Configuration

- Ensure services are configured to accept connections from the tunnel
- Check service logs for connection issues
- Test service accessibility before forwarding

## Integration with Development Workflows

### Docker Integration

```bash
# Forward Docker container port
./cli riterm-quic listen-tcp 127.0.0.1:8080 \
  --remote-host host.docker.internal \
  --remote-port 8080
```

### Kubernetes Integration

```bash
# Port-forward Kubernetes service
kubectl port-forward svc/my-service 8080:80 &
./cli riterm-quic listen-tcp 127.0.0.1:8080 --qr
```

### CI/CD Integration

```bash
# Expose staging environment for testing
./cli riterm-quic listen-tcp staging.example.com:80 \
  --output staging-ticket.txt
```

## Comparison with Alternatives

| Feature | RiTerm TCP Forwarding | ngrok | LocalTunnel | SSH Tunneling |
|---------|----------------------|-------|-------------|---------------|
| P2P Connection | ✅ | ❌ | ❌ | ❌ |
| End-to-End Encryption | ✅ | ✅ | ✅ | ✅ |
| No Third-Party Server | ✅ | ❌ | ❌ | ❌ |
| QR Code Support | ✅ | ❌ | ❌ | ❌ |
| Multiple Connections | ✅ | ❌ | ❌ | ✅ |
| Free Usage | ✅ | Limited | Limited | ✅ |

## Advanced Configuration

### Custom Relay Servers

```bash
# Use custom relay server
./cli riterm-quic listen-tcp 127.0.0.1:3000 \
  --relay https://my-relay.example.com

# Connect with custom relay
./cli riterm-quic connect-tcp TF_TICKET... \
  --relay https://my-relay.example.com
```

### Connection Limits

```bash
# Limit concurrent connections (when implemented)
./cli riterm-quic listen-tcp 0.0.0.0:8080 \
  --max-connections 10
```

### Session Timeouts

```bash
# Set custom timeout (when implemented)
./cli riterm-quic listen-tcp 127.0.0.1:5432 \
  --timeout 3600
```

This documentation provides comprehensive examples and guidance for using RiTerm's TCP forwarding capabilities in various scenarios.
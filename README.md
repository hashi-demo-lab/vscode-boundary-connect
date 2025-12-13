# Boundary VS Code Extension

[![CI](https://github.com/hashi-demo-lab/vscode-boundary-connect/actions/workflows/ci.yml/badge.svg)](https://github.com/hashi-demo-lab/vscode-boundary-connect/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/hashi-demo-lab/vscode-boundary-connect/branch/main/graph/badge.svg)](https://codecov.io/gh/hashi-demo-lab/vscode-boundary-connect)

HashiCorp Boundary integration for VS Code Remote SSH. Connect securely to your infrastructure using Boundary's identity-based access management.

## Features

- **OIDC Authentication**: Sign in using your organization's identity provider (Okta, Azure AD, etc.)
- **Target Discovery**: Browse available targets from Boundary with hierarchical organization
- **One-Click Connect**: Connect to targets via VS Code Remote SSH
- **Session Management**: View and manage active Boundary sessions
- **Multi-Auth Support**: Support for both OIDC and password authentication methods

## Requirements

- [Boundary CLI](https://developer.hashicorp.com/boundary/downloads) installed and available in PATH
- VS Code 1.75.0 or higher
- Remote - SSH extension for connecting to targets

## Quick Start

1. Install the extension
2. Click the Boundary icon in the Activity Bar
3. Click "Get Started" to configure your Boundary server address
4. Sign in using your organization's authentication method
5. Browse and connect to available targets

## Extension Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `boundary.cliPath` | Path to Boundary CLI executable | `boundary` |
| `boundary.addr` | Boundary controller address | Uses `BOUNDARY_ADDR` env var |
| `boundary.tlsInsecure` | Skip TLS verification (dev only) | `false` |
| `boundary.defaultAuthMethod` | Default auth method (oidc/password) | `oidc` |
| `boundary.logLevel` | Extension log level | `info` |

## Development

```bash
# Install dependencies
npm install

# Run linting
npm run lint

# Run tests
npm test

# Build extension
npm run compile

# Package extension
npm run package
```

## License

MPL-2.0 - See [LICENSE.txt](LICENSE.txt) for details.

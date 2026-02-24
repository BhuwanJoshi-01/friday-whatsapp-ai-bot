#!/bin/bash

# Clean WhatsApp authentication data and sessions
# Equivalent to clean_auth.ps1 for Ubuntu/Linux

# Stop any running node processes
pkill -f node || true

# Remove auth directories
rm -rf .wwebjs_auth_local
rm -rf baileys_auth

echo "Auth data cleared. You will need to scan QR code again."
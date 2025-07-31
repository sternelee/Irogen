#!/bin/bash

echo "🚀 riterm - Enhanced Multi-Shell Configuration Support"
echo "======================================================"
echo ""

echo "🔍 Available shells on this system:"
cargo run -- host --list-shells 2>/dev/null | grep -E "→|[0-9]\."
echo ""

echo "🐚 Enhanced Shell Support:"
echo ""

echo "1. 📦 Zsh with oh-my-zsh:"
echo "   ✅ Auto-detects ~/.zshrc, oh-my-zsh installation"
echo "   ✅ Loads plugins: $(grep plugins ~/.zshrc | sed 's/.*(//' | sed 's/).*//' 2>/dev/null || echo 'Not configured')"
echo "   ✅ Theme: $(grep ZSH_THEME ~/.zshrc | cut -d'"' -f2 2>/dev/null || echo 'Not configured')"
echo "   📁 Config: ~/.zshrc, ~/.oh-my-zsh"
echo ""

echo "2. 🐟 Fish Shell:"
echo "   ✅ Auto-detects ~/.config/fish/config.fish"
echo "   ✅ Loads functions from ~/.config/fish/functions/"
echo "   ✅ Custom completions from ~/.config/fish/completions/"
echo "   ✅ Fish variables and universal variables"
if [ -d ~/.config/fish ]; then
  echo "   📁 Config found: ~/.config/fish/"
  echo "   📊 Functions: $(ls ~/.config/fish/functions/ 2>/dev/null | wc -l | tr -d ' ') files"
  echo "   📊 Completions: $(ls ~/.config/fish/completions/ 2>/dev/null | wc -l | tr -d ' ') files"
else
  echo "   📁 Config: Not found"
fi
echo ""

echo "3. 🦀 Nushell:"
echo "   ✅ Auto-detects ~/.config/nushell/config.nu"
echo "   ✅ Environment file ~/.config/nushell/env.nu"
echo "   ✅ Structured data and modern shell features"
if [ -f ~/.config/nushell/config.nu ]; then
  echo "   📁 Config found: ~/.config/nushell/"
  echo "   📊 Startup commands: $(grep -c "source" ~/.config/nushell/config.nu 2>/dev/null || echo 0)"
else
  echo "   📁 Config: Not found"
fi
echo ""

echo "4. ⚡ PowerShell:"
echo "   ✅ Auto-detects PowerShell profiles"
echo "   ✅ Cross-platform configuration support"
echo "   ✅ Module and script loading"
echo "   📁 Profile locations checked:"
echo "     - ~/.config/powershell/Microsoft.PowerShell_profile.ps1"
echo "     - ~/Documents/PowerShell/Microsoft.PowerShell_profile.ps1"
echo ""

echo "🎯 Testing Shell Configurations:"
echo ""

echo "To test each shell with full configuration loading:"
echo ""
echo "  # Zsh with oh-my-zsh and plugins"
echo "  riterm host --shell zsh --passthrough"
echo ""
echo "  # Fish with functions and completions"
echo "  riterm host --shell fish --passthrough"
echo ""
echo "  # Nushell with structured data support"
echo "  riterm host --shell nu --passthrough"
echo ""
echo "  # PowerShell with profile loading"
echo "  riterm host --shell pwsh --passthrough"
echo ""

echo "🔧 Configuration Features:"
echo ""
echo "  ✅ Automatic config file detection"
echo "  ✅ Environment variable setup"
echo "  ✅ Plugin/module loading"
echo "  ✅ Theme and customization preservation"
echo "  ✅ Function and completion loading"
echo "  ✅ Fallback to basic configuration if no user config found"
echo ""

echo "🌐 P2P Session Sharing:"
echo "  • All users see the same shell environment"
echo "  • Plugins and customizations work for all participants"
echo "  • Real-time terminal interaction"
echo "  • Session recording and playback"
echo ""

echo "🚀 Start your enhanced shell session now!"


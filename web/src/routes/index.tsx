import { createFileRoute, Link } from '@tanstack/solid-router'
import { For } from 'solid-js'
import {
  Terminal,
  Wifi,
  Bot,
  Shield,
  Zap,
  Globe,
  Cpu,
  ArrowRight,
} from 'lucide-solid'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  const features = [
    {
      icon: <Terminal class="w-10 h-10 text-primary" />,
      title: 'Multi-Agent Support',
      description:
        'Run Claude, Codex, Gemini, OpenCode and more from a unified interface.',
    },
    {
      icon: <Wifi class="w-10 h-10 text-primary" />,
      title: 'Remote P2P Connection',
      description:
        'Connect to remote agents securely via iroh P2P with NAT traversal.',
    },
    {
      icon: <Shield class="w-10 h-10 text-primary" />,
      title: 'Permission Control',
      description:
        'Review and approve tool executions before they run on your machine.',
    },
    {
      icon: <Zap class="w-10 h-10 text-primary" />,
      title: 'Streaming Responses',
      description:
        'Real-time streaming of AI responses with tool call visualization.',
    },
    {
      icon: <Globe class="w-10 h-10 text-primary" />,
      title: 'Browser Access',
      description:
        'Access your remote agents from any browser with the WASM client.',
    },
    {
      icon: <Cpu class="w-10 h-10 text-primary" />,
      title: 'Cross-Platform',
      description:
        'Desktop, mobile, and web clients powered by Tauri 2 and SolidJS.',
    },
  ]

  const agents = [
    { name: 'Claude', color: 'from-orange-500 to-red-500' },
    { name: 'Codex', color: 'from-green-500 to-emerald-500' },
    { name: 'Gemini', color: 'from-blue-500 to-cyan-500' },
    { name: 'OpenCode', color: 'from-purple-500 to-pink-500' },
    { name: 'OpenClaw', color: 'from-yellow-500 to-orange-500' },
  ]

  return (
    <div class="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      {/* Hero Section */}
      <section class="relative py-20 px-6 text-center overflow-hidden">
        <div class="absolute inset-0 bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-purple-500/10"></div>
        <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-900/20 via-transparent to-transparent"></div>

        <div class="relative max-w-5xl mx-auto">
          {/* Logo and Title */}
          <div class="flex items-center justify-center gap-4 mb-6">
            <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/30">
              <Bot class="w-8 h-8 text-white" />
            </div>
            <h1 class="text-5xl md:text-6xl font-black text-white">
              <span class="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                ClawdPilot
              </span>
            </h1>
          </div>

          {/* Subtitle */}
          <p class="text-2xl md:text-3xl text-base-content mb-4 font-light">
            Multi-Agent Remote Management Platform
          </p>
          <p class="text-lg text-neutral max-w-2xl mx-auto mb-8">
            Control multiple AI agents (Claude, Codex, Gemini, OpenCode,
            OpenClaw) from anywhere. Secure P2P connections with end-to-end
            encryption.
          </p>

          {/* CTA Buttons */}
          <div class="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
            <Link
              to="/session"
              class="flex items-center gap-2 px-8 py-3 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white font-semibold rounded-xl transition-all shadow-lg shadow-cyan-500/30 hover:shadow-cyan-500/50"
            >
              <Terminal class="w-5 h-5" />
              Open Session
              <ArrowRight class="w-4 h-4" />
            </Link>
            <a
              href="https://github.com/sternelee/riterm"
              target="_blank"
              rel="noopener noreferrer"
              class="px-8 py-3 bg-base-300 hover:bg-base-200 text-white font-semibold rounded-xl transition-colors border border-base-300"
            >
              View on GitHub
            </a>
          </div>

          {/* Supported Agents */}
          <div class="flex flex-wrap items-center justify-center gap-3">
            <span class="text-sm text-neutral mr-2">Supported Agents:</span>
            <For each={agents}>
              {(agent) => (
                <span
                  class={`px-3 py-1 rounded-full text-sm font-medium text-white bg-gradient-to-r ${agent.color}`}
                >
                  {agent.name}
                </span>
              )}
            </For>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section class="py-16 px-6 max-w-7xl mx-auto">
        <h2 class="text-3xl font-bold text-white text-center mb-12">
          Features
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <For each={features}>
            {(feature) => (
              <div class="bg-base-200 backdrop-blur-sm border border-base-300 rounded-xl p-6 hover:border-primary/50 transition-all duration-300 hover:shadow-lg hover:shadow-primary/10 group">
                <div class="mb-4 group-hover:scale-110 transition-transform">
                  {feature.icon}
                </div>
                <h3 class="text-xl font-semibold text-white mb-3">
                  {feature.title}
                </h3>
                <p class="text-neutral leading-relaxed">
                  {feature.description}
                </p>
              </div>
            )}
          </For>
        </div>
      </section>

      {/* How It Works Section */}
      <section class="py-16 px-6 bg-base-200/30">
        <div class="max-w-4xl mx-auto">
          <h2 class="text-3xl font-bold text-white text-center mb-12">
            How It Works
          </h2>

          <div class="space-y-8">
            <div class="flex items-start gap-4">
              <div class="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 text-primary font-bold">
                1
              </div>
              <div>
                <h3 class="text-lg font-semibold text-white mb-1">
                  Run CLI Host
                </h3>
                <p class="text-neutral">
                  Start the ClawdPilot CLI host on your machine with{' '}
                  <code class="px-2 py-0.5 bg-base-300 rounded text-primary">
                    clawdpilot host
                  </code>
                  . It generates a session ticket for secure connections.
                </p>
              </div>
            </div>

            <div class="flex items-start gap-4">
              <div class="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 text-primary font-bold">
                2
              </div>
              <div>
                <h3 class="text-lg font-semibold text-white mb-1">
                  Connect from Browser
                </h3>
                <p class="text-neutral">
                  Open this web app and enter the session ticket (or scan the QR
                  code). The WASM client establishes a secure P2P connection via
                  iroh.
                </p>
              </div>
            </div>

            <div class="flex items-start gap-4">
              <div class="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0 text-primary font-bold">
                3
              </div>
              <div>
                <h3 class="text-lg font-semibold text-white mb-1">
                  Start Your Agent
                </h3>
                <p class="text-neutral">
                  Choose your AI agent (Claude, Codex, etc.) and project path.
                  Interact with the agent in real-time with streaming responses.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer class="py-8 px-6 border-t border-base-300">
        <div class="max-w-7xl mx-auto text-center text-neutral text-sm">
          <p>ClawdPilot - Multi-Agent Remote Management Platform</p>
          <p class="mt-2">Built with Tauri 2, SolidJS, and iroh P2P</p>
        </div>
      </footer>
    </div>
  )
}

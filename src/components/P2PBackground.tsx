export const P2PBackground = () => {
  return (
    <div class="fixed inset-0 overflow-hidden z-0">
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 1200 800"
        preserveAspectRatio="none"
        class="absolute inset-0"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* 渐变背景 */}
        <defs>
          <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#0f172a" />
            <stop offset="100%" stop-color="#1e293b" />
          </linearGradient>

          {/* 终端文字动画 */}
          <mask id="terminalMask">
            <rect width="100%" height="100%" fill="white" />
            <g fill="black">
              <text
                x="100"
                y="150"
                font-family="monospace"
                font-size="16"
                opacity="0.7"
              >
                npm install @riterm/core
              </text>
              <text
                x="150"
                y="180"
                font-family="monospace"
                font-size="16"
                opacity="0.7"
              >
                git clone https://github.com/riterm
              </text>
              <text
                x="200"
                y="210"
                font-family="monospace"
                font-size="16"
                opacity="0.7"
              >
                cargo build --release
              </text>
              <text
                x="250"
                y="240"
                font-family="monospace"
                font-size="16"
                opacity="0.7"
              >
                docker run -d riterm/server
              </text>
              <text
                x="300"
                y="270"
                font-family="monospace"
                font-size="16"
                opacity="0.7"
              >
                kubectl apply -f riterm.yaml
              </text>

              <text
                x="700"
                y="150"
                font-family="monospace"
                font-size="16"
                opacity="0.7"
              >
                ping 192.168.1.100
              </text>
              <text
                x="650"
                y="180"
                font-family="monospace"
                font-size="16"
                opacity="0.7"
              >
                ssh user@remote-server
              </text>
              <text
                x="600"
                y="210"
                font-family="monospace"
                font-size="16"
                opacity="0.7"
              >
                tail -f /var/log/app.log
              </text>
              <text
                x="550"
                y="240"
                font-family="monospace"
                font-size="16"
                opacity="0.7"
              >
                ps aux | grep riterm
              </text>
              <text
                x="500"
                y="270"
                font-family="monospace"
                font-size="16"
                opacity="0.7"
              >
                netstat -tuln | grep 8080
              </text>
            </g>
          </mask>

          {/* 闪烁动画 */}
          <style>
            {`
              @keyframes blink {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.3; }
              }
              @keyframes pulse {
                0%, 100% { opacity: 0.8; }
                50% { opacity: 0.4; }
              }
              @keyframes float {
                0%, 100% { transform: translateY(0px); }
                50% { transform: translateY(-10px); }
              }
              .blink { animation: blink 1.5s infinite; }
              .pulse { animation: pulse 2s infinite; }
              .float { animation: float 3s ease-in-out infinite; }
            `}
          </style>
        </defs>

        {/* 背景渐变 */}
        <rect width="100%" height="100%" fill="url(#bgGradient)" />

        {/* 网格线 */}
        <g stroke="#334155" stroke-width="0.5" opacity="0.3">
          {[...Array(40)].map((_, i) => (
            <line x1={i * 30} y1="0" x2={i * 30} y2="800" />
          ))}
          {[...Array(30)].map((_, i) => (
            <line x1="0" y1={i * 30} x2="1200" y2={i * 30} />
          ))}
        </g>

        {/* PC电脑 1 */}
        <g transform="translate(150, 200)">
          <rect
            x="0"
            y="0"
            width="120"
            height="80"
            rx="4"
            fill="#334155"
            stroke="#475569"
            stroke-width="2"
          />
          <rect x="5" y="5" width="110" height="50" rx="2" fill="#0f172a" />
          <g fill="#4ade80" font-family="monospace" font-size="6">
            <text x="10" y="15">
              user@pc1:~$
            </text>
            <text x="10" y="25" class="blink">
              _
            </text>
          </g>
          <rect x="30" y="80" width="60" height="5" rx="2" fill="#475569" />
        </g>

        {/* Mac电脑 1 */}
        <g transform="translate(500, 150)">
          <rect
            x="0"
            y="0"
            width="200"
            height="90"
            rx="10"
            fill="#334155"
            stroke="#475569"
            stroke-width="2"
          />
          <rect x="5" y="5" width="190" height="60" rx="6" fill="#0f172a" />
          <g fill="#60a5fa" font-family="monospace" font-size="6">
            <text x="10" y="15">
              user@mac1:~$
            </text>
            <text x="10" y="25">
              ls -la
            </text>
            <text x="10" y="35">
              drwxr-xr-x 8 user staff 256 Jun 12 14:30 .
            </text>
            <text x="10" y="45">
              drwxr-xr-x 5 user staff 160 Jun 10 09:15 ..
            </text>
          </g>
          <circle cx="70" cy="85" r="3" fill="#475569" />
        </g>

        {/* PC电脑 2 */}
        <g transform="translate(900, 200)">
          <rect
            x="0"
            y="0"
            width="180"
            height="80"
            rx="4"
            fill="#334155"
            stroke="#475569"
            stroke-width="2"
          />
          <rect x="5" y="5" width="170" height="50" rx="2" fill="#0f172a" />
          <g fill="#f87171" font-family="monospace" font-size="6">
            <text x="10" y="15">
              admin@server:~$
            </text>
            <text x="10" y="25">
              systemctl status riterm
            </text>
            <text x="10" y="35">
              ● riterm.service - RiTerm Service
            </text>
            <text x="10" y="45">
              Active: active (running)
            </text>
          </g>
          <rect x="30" y="80" width="60" height="5" rx="2" fill="#475569" />
        </g>

        {/* Mac电脑 2 */}
        <g transform="translate(300, 400)">
          <rect
            x="0"
            y="0"
            width="140"
            height="90"
            rx="10"
            fill="#334155"
            stroke="#475569"
            stroke-width="2"
          />
          <rect x="5" y="5" width="130" height="60" rx="6" fill="#0f172a" />
          <g fill="#fbbf24" font-family="monospace" font-size="6">
            <text x="10" y="15">
              dev@mac2:~/project$
            </text>
            <text x="10" y="25">
              git push origin main
            </text>
            <text x="10" y="35">
              Counting objects: 3, done.
            </text>
            <text x="10" y="45">
              Writing objects: 100% (3/3)
            </text>
          </g>
          <circle cx="70" cy="85" r="3" fill="#475569" />
        </g>

        {/* 连接线 - 所有设备连接到中心手机 */}
        <g
          stroke="#60a5fa"
          stroke-width="1"
          stroke-dasharray="5,5"
          class="pulse"
        >
          {/* PC1 到手机 */}
          <line x1="210" y1="240" x2="580" y2="360" />
          {/* Mac1 到手机 */}
          <line x1="570" y1="195" x2="580" y2="360" />
          {/* PC2 到手机 */}
          <line x1="960" y1="240" x2="580" y2="360" />
          {/* Mac2 到手机 */}
          <line x1="370" y1="445" x2="580" y2="360" />
        </g>

        {/* 手机设备 - 中心监控 */}
        <g transform="translate(550, 300)">
          <rect
            x="0"
            y="0"
            width="80"
            height="120"
            rx="10"
            fill="#334155"
            stroke="#475569"
            stroke-width="2"
          />
          <rect x="5" y="5" width="70" height="110" rx="8" fill="#0f172a" />
          <rect x="25" y="2" width="10" height="3" rx="1" fill="#475569" />
          <g fill="#4ade80" font-family="monospace" font-size="4">
            <text x="8" y="15">
              STATUS: ONLINE
            </text>
            <text x="8" y="25">
              NODES: 4
            </text>
            <text x="8" y="35">
              ACTIVE: 3
            </text>
            <text x="8" y="45">
              LATENCY: 24ms
            </text>
          </g>
          <g fill="#60a5fa" font-family="monospace" font-size="3">
            <text x="8" y="60">
              PC1: ✓
            </text>
            <text x="8" y="68">
              MAC1: ✓
            </text>
            <text x="8" y="76">
              PC2: ✓
            </text>
            <text x="8" y="84">
              MAC2: ○
            </text>
          </g>
        </g>

        {/* 数据流动画 - 沿着连接线移动到中心手机 */}
        <circle cx="210" cy="240" r="3" fill="#4ade80" class="pulse">
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0,0; 370,120; 0,0"
            dur="3s"
            repeatCount="indefinite"
          />
        </circle>
        <circle
          cx="570"
          cy="195"
          r="3"
          fill="#60a5fa"
          class="pulse"
          style="animation-delay: 0.5s"
        >
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0,0; 10,165; 0,0"
            dur="2.5s"
            repeatCount="indefinite"
          />
        </circle>
        <circle
          cx="960"
          cy="240"
          r="3"
          fill="#f87171"
          class="pulse"
          style="animation-delay: 1s"
        >
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0,0; -380,120; 0,0"
            dur="3.5s"
            repeatCount="indefinite"
          />
        </circle>
        <circle
          cx="370"
          cy="445"
          r="3"
          fill="#fbbf24"
          class="pulse"
          style="animation-delay: 1.5s"
        >
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0,0; 210,-85; 0,0"
            dur="2.8s"
            repeatCount="indefinite"
          />
        </circle>

        {/* 网络节点连接点 */}
        <circle cx="210" cy="240" r="5" fill="#4ade80" class="blink" />
        <circle cx="570" cy="195" r="5" fill="#60a5fa" class="blink" />
        <circle cx="960" cy="240" r="5" fill="#f87171" class="blink" />
        <circle cx="370" cy="445" r="5" fill="#fbbf24" class="blink" />
        <circle cx="580" cy="360" r="6" fill="#10b981" class="blink" />
      </svg>
    </div>
  );
};

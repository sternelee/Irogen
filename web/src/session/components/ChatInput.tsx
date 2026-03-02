/**
 * ChatInput Component
 *
 * Message input with send and interrupt buttons
 */

import { createSignal, Show } from 'solid-js'
import { Send, Square, Paperclip, Image } from 'lucide-solid'

interface ChatInputProps {
  onSend: (content: string) => Promise<void>
  onInterrupt: () => Promise<void>
  isStreaming: boolean
  disabled?: boolean
  placeholder?: string
}

export function ChatInput(props: ChatInputProps) {
  const [input, setInput] = createSignal('')
  const [isSubmitting, setIsSubmitting] = createSignal(false)

  const handleSubmit = async (e?: Event) => {
    e?.preventDefault()
    const content = input().trim()
    if (!content || props.isStreaming || isSubmitting()) return

    setIsSubmitting(true)
    try {
      await props.onSend(content)
      setInput('')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleInput = (e: Event) => {
    const target = e.currentTarget as HTMLTextAreaElement
    setInput(target.value)

    // Auto-resize
    target.style.height = 'auto'
    target.style.height = Math.min(target.scrollHeight, 200) + 'px'
  }

  return (
    <div class="relative">
      <div class="flex items-end gap-2 bg-slate-900 border border-slate-600 rounded-xl p-2 focus-within:ring-2 focus-within:ring-cyan-500 focus-within:border-transparent">
        {/* Tool Buttons */}
        <div class="flex items-center gap-1 pb-1">
          <button
            type="button"
            title="Attach file"
            class="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <Paperclip class="w-4 h-4" />
          </button>
          <button
            type="button"
            title="Add image"
            class="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
          >
            <Image class="w-4 h-4" />
          </button>
        </div>

        {/* Text Input */}
        <textarea
          value={input()}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={props.placeholder || 'Type a message...'}
          disabled={props.disabled || isSubmitting()}
          rows={1}
          class="flex-1 bg-transparent text-white placeholder-slate-500 resize-none focus:outline-none disabled:opacity-50 min-h-[40px] max-h-[200px] py-2"
          style={{ 'overflow-y': 'auto' }}
        />

        {/* Action Buttons */}
        <div class="flex items-center gap-1 pb-1">
          <Show when={props.isStreaming}>
            <button
              type="button"
              onClick={() => props.onInterrupt()}
              class="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
              title="Stop"
            >
              <Square class="w-4 h-4" />
            </button>
          </Show>

          <Show when={!props.isStreaming}>
            <button
              type="button"
              onClick={() => handleSubmit()}
              disabled={!input().trim() || props.disabled || isSubmitting()}
              class="p-2 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 disabled:text-slate-500 disabled:cursor-not-allowed rounded-lg transition-colors"
              title="Send"
            >
              <Send class="w-4 h-4" />
            </button>
          </Show>
        </div>
      </div>

      {/* Help Text */}
      <div class="flex items-center justify-between mt-2 px-2">
        <span class="text-xs text-slate-500">
          Press Enter to send, Shift+Enter for new line
        </span>
        <Show when={props.isStreaming}>
          <span class="text-xs text-cyan-400 animate-pulse">
            Agent is responding...
          </span>
        </Show>
      </div>
    </div>
  )
}

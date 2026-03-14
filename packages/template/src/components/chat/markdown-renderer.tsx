import * as React from "react"
import ReactMarkdown from "react-markdown"
import type { Components } from "react-markdown"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface MarkdownRendererProps {
  content: string
  className?: string
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={handleCopy}
      className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  )
}

const components: Components = {
  code({ className, children, ...props }) {
    const isBlock = Boolean(className?.startsWith("language-"))
    const language = className?.replace("language-", "") ?? ""
    const text = String(children).replace(/\n$/, "")

    if (isBlock) {
      return (
        <div className="my-2 overflow-hidden rounded-md border border-border bg-muted/50">
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
            <span className="text-xs text-muted-foreground font-mono">
              {language || "code"}
            </span>
            <CopyButton text={text} />
          </div>
          <pre className="overflow-x-auto p-3">
            <code className="font-mono text-sm">{text}</code>
          </pre>
        </div>
      )
    }

    return (
      <code
        className="bg-muted px-1 py-0.5 rounded text-sm font-mono"
        {...props}
      >
        {children}
      </code>
    )
  },
  a({ children, href, ...props }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
        {...props}
      >
        {children}
      </a>
    )
  },
  p({ children, ...props }) {
    return (
      <p className="mb-2 last:mb-0 leading-relaxed" {...props}>
        {children}
      </p>
    )
  },
  h1({ children, ...props }) {
    return (
      <h1 className="text-base font-semibold mb-2 mt-3 first:mt-0" {...props}>
        {children}
      </h1>
    )
  },
  h2({ children, ...props }) {
    return (
      <h2 className="text-sm font-semibold mb-1.5 mt-3 first:mt-0" {...props}>
        {children}
      </h2>
    )
  },
  h3({ children, ...props }) {
    return (
      <h3 className="text-sm font-semibold mb-1 mt-2 first:mt-0" {...props}>
        {children}
      </h3>
    )
  },
  ul({ children, ...props }) {
    return (
      <ul className="mb-2 list-disc pl-4 space-y-0.5 last:mb-0" {...props}>
        {children}
      </ul>
    )
  },
  ol({ children, ...props }) {
    return (
      <ol className="mb-2 list-decimal pl-4 space-y-0.5 last:mb-0" {...props}>
        {children}
      </ol>
    )
  },
  li({ children, ...props }) {
    return (
      <li className="text-sm leading-relaxed" {...props}>
        {children}
      </li>
    )
  },
  blockquote({ children, ...props }) {
    return (
      <blockquote
        className="border-l-2 border-border pl-3 italic text-muted-foreground my-2"
        {...props}
      >
        {children}
      </blockquote>
    )
  },
}

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn("text-sm", className)}>
      <ReactMarkdown components={components}>{content}</ReactMarkdown>
    </div>
  )
}

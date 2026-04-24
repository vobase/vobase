import { getMentionOnSelectItem, type TMentionItemBase } from '@platejs/mention'
import { MentionInputPlugin, MentionPlugin } from '@platejs/mention/react'
import type { TComboboxInputElement, Value } from 'platejs'
import { Plate, PlateContent, PlateElement, type PlateElementProps, usePlateEditor } from 'platejs/react'
import { useImperativeHandle, useState } from 'react'

import {
  InlineCombobox,
  InlineComboboxContent,
  InlineComboboxEmpty,
  InlineComboboxGroup,
  InlineComboboxGroupLabel,
  InlineComboboxInput,
  InlineComboboxItem,
} from '@/components/ui/inline-combobox'
import { MentionElement } from '@/components/ui/mention-node'
import { cn } from '@/lib/utils'
import { PrincipalAvatar, usePrincipalDirectory } from './principal'

export interface NoteEditorHandle {
  getValue: () => { body: string; mentions: string[] }
  reset: () => void
  focus: () => void
}

export interface NoteEditorProps {
  handleRef: React.Ref<NoteEditorHandle>
  placeholder?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void
  onEmptyChange?: (empty: boolean) => void
  className?: string
}

interface MentionItem extends TMentionItemBase {
  kind: 'agent' | 'staff'
}

const emptyValue: Value = [{ type: 'p', children: [{ text: '' }] }]

function MentionInputElement(props: PlateElementProps<TComboboxInputElement>) {
  const { editor, element } = props
  const [search, setSearch] = useState('')
  const { agents, staff } = usePrincipalDirectory()

  const onSelect = getMentionOnSelectItem<MentionItem>()

  return (
    <PlateElement {...props} as="span">
      <InlineCombobox value={search} element={element} setValue={setSearch} showTrigger={false} trigger="@">
        <span className="inline-block rounded-md bg-muted px-1 align-baseline text-sm ring-ring focus-within:ring-2">
          <InlineComboboxInput />
        </span>
        <InlineComboboxContent className="my-1.5 min-w-[200px]">
          <InlineComboboxEmpty>No matches</InlineComboboxEmpty>
          {agents.length > 0 && (
            <InlineComboboxGroup>
              <InlineComboboxGroupLabel>AI Agents</InlineComboboxGroupLabel>
              {agents.map((a) => {
                const item: MentionItem = { key: `agent:${a.id}`, text: a.name, kind: 'agent' }
                return (
                  <InlineComboboxItem
                    key={item.key}
                    value={item.text}
                    onClick={() => onSelect(editor, item, search)}
                    className="gap-2 text-sm"
                  >
                    <PrincipalAvatar kind="agent" />
                    <span className="font-medium">{item.text}</span>
                  </InlineComboboxItem>
                )
              })}
            </InlineComboboxGroup>
          )}
          {staff.length > 0 && (
            <InlineComboboxGroup>
              <InlineComboboxGroupLabel>Team Members</InlineComboboxGroupLabel>
              {staff.map((s) => {
                const item: MentionItem = { key: `staff:${s.id}`, text: s.name, kind: 'staff' }
                return (
                  <InlineComboboxItem
                    key={item.key}
                    value={item.text}
                    onClick={() => onSelect(editor, item, search)}
                    className="gap-2 text-sm"
                  >
                    <PrincipalAvatar kind="staff" />
                    <span className="font-medium">{item.text}</span>
                  </InlineComboboxItem>
                )
              })}
            </InlineComboboxGroup>
          )}
        </InlineComboboxContent>
      </InlineCombobox>
      {props.children}
    </PlateElement>
  )
}

const plugins = [
  MentionPlugin.configure({
    options: {
      triggerPreviousCharPattern: /^$|^[\s"']$/,
      insertSpaceAfterMention: true,
    },
  }).withComponent(MentionElement),
  MentionInputPlugin.withComponent(MentionInputElement),
]

function serialize(value: Value): { body: string; mentions: string[] } {
  const mentions = new Set<string>()
  const lines: string[] = []
  for (const block of value) {
    let line = ''
    const children = (block as { children?: Array<Record<string, unknown>> }).children ?? []
    for (const child of children) {
      if (child.type === 'mention') {
        const key = typeof child.key === 'string' ? child.key : ''
        const name = typeof child.value === 'string' ? child.value : ''
        if (key) mentions.add(key)
        line += `@${name}`
      } else if (typeof child.text === 'string') {
        line += child.text
      }
    }
    lines.push(line)
  }
  return { body: lines.join('\n').trim(), mentions: Array.from(mentions) }
}

export function NoteEditor({ handleRef, placeholder, onKeyDown, onEmptyChange, className }: NoteEditorProps) {
  const editor = usePlateEditor({ plugins, value: emptyValue })

  useImperativeHandle(handleRef, () => ({
    getValue: () => serialize(editor.children as Value),
    reset: () => {
      editor.tf.reset()
      editor.tf.setValue(emptyValue)
      onEmptyChange?.(true)
    },
    focus: () => editor.tf.focus(),
  }))

  return (
    <Plate
      editor={editor}
      onChange={() => {
        onEmptyChange?.(!serialize(editor.children as Value).body)
      }}
    >
      <PlateContent
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={cn(
          'h-[76px] max-h-48 w-full overflow-y-auto px-3 py-2 text-sm leading-5 outline-none',
          'placeholder:text-muted-foreground [&_*]:my-0',
          className,
        )}
      />
    </Plate>
  )
}

/**
 * DriveUpload — tiny toolbar to create a new text file or folder under the
 * current root. Binary/multipart upload is out of scope for slice 4; the drive
 * handlers only accept inline text content via PUT /file.
 */

import { FilePlus, FolderPlus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useMkdir, useWriteFile } from '../api/use-drive'
import { useDriveContext } from './drive-provider'

type Mode = 'idle' | 'file' | 'folder'

export function DriveUpload() {
  const { scope } = useDriveContext()
  const writeFile = useWriteFile(scope)
  const mkdir = useMkdir(scope)
  const [mode, setMode] = useState<Mode>('idle')
  const [path, setPath] = useState('')

  async function submit() {
    if (!path.startsWith('/')) return
    if (mode === 'file') await writeFile.mutateAsync({ path, content: '' })
    else if (mode === 'folder') await mkdir.mutateAsync(path)
    setMode('idle')
    setPath('')
  }

  if (mode === 'idle') {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button size="sm" variant="ghost" onClick={() => setMode('file')}>
          <FilePlus className="mr-1 size-3.5" /> New file
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMode('folder')}>
          <FolderPlus className="mr-1 size-3.5" /> New folder
        </Button>
      </div>
    )
  }

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <Input
        autoFocus
        value={path}
        onChange={(e) => setPath(e.target.value)}
        placeholder={mode === 'file' ? '/path/to/file.md' : '/path/to/folder'}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') {
            setMode('idle')
            setPath('')
          }
        }}
        className="h-8 text-xs"
      />
      <Button size="sm" onClick={() => void submit()} disabled={!path.startsWith('/')}>
        Create
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setMode('idle')}>
        Cancel
      </Button>
    </div>
  )
}

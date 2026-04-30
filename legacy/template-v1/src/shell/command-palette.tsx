import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, Laptop, Moon, Sun } from 'lucide-react'

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { ScrollArea } from '@/components/ui/scroll-area'
import { navGroups } from '@/constants/navigation'
import { type Theme, useTheme } from '@/hooks/use-theme'
import { useSearch } from '@/providers/search-provider'

export function CommandPalette() {
  const navigate = useNavigate()
  const { setTheme } = useTheme()
  const { open, setOpen } = useSearch()

  function runCommand(command: () => unknown) {
    setOpen(false)
    command()
  }

  return (
    <CommandDialog modal open={open} onOpenChange={setOpen} showCloseButton={false}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <ScrollArea type="hover" className="h-72 pe-1">
          <CommandEmpty>No results found.</CommandEmpty>
          {navGroups.map((group) => (
            <CommandGroup key={group.title} heading={group.title}>
              {group.items.map((navItem) => {
                if (navItem.url) {
                  const searchValue = [navItem.title, ...(navItem.keywords ?? [])].join(' ')
                  return (
                    <CommandItem
                      key={navItem.url}
                      value={searchValue}
                      onSelect={() => {
                        runCommand(() => navigate({ to: navItem.url }))
                      }}
                    >
                      <div className="flex size-4 items-center justify-center">
                        {navItem.icon ? (
                          <navItem.icon className="size-3.5 text-muted-foreground/80" />
                        ) : (
                          <ArrowRight className="size-2 text-muted-foreground/80" />
                        )}
                      </div>
                      {navItem.title}
                    </CommandItem>
                  )
                }

                return navItem.items?.map((subItem) => {
                  const searchValue = [navItem.title, subItem.title, ...(subItem.keywords ?? [])].join(' ')
                  return (
                    <CommandItem
                      key={`${navItem.title}-${subItem.url}`}
                      value={searchValue}
                      onSelect={() => {
                        runCommand(() => navigate({ to: subItem.url }))
                      }}
                    >
                      <div className="flex size-4 items-center justify-center">
                        {subItem.icon ? (
                          <subItem.icon className="size-3.5 text-muted-foreground/80" />
                        ) : (
                          <ArrowRight className="size-2 text-muted-foreground/80" />
                        )}
                      </div>
                      {subItem.title}
                    </CommandItem>
                  )
                })
              })}
            </CommandGroup>
          ))}
          <CommandSeparator />
          <CommandGroup heading="Theme">
            <CommandItem onSelect={() => runCommand(() => setTheme('light' as Theme))}>
              <Sun />
              <span>Light</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => setTheme('dark' as Theme))}>
              <Moon className="scale-90" />
              <span>Dark</span>
            </CommandItem>
            <CommandItem onSelect={() => runCommand(() => setTheme('system' as Theme))}>
              <Laptop />
              <span>System</span>
            </CommandItem>
          </CommandGroup>
        </ScrollArea>
      </CommandList>
    </CommandDialog>
  )
}

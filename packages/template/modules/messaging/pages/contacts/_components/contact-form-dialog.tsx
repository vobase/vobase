import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface ContactFormData {
  name?: string;
  phone?: string;
  email?: string;
  identifier?: string;
  role: string;
}

export function ContactFormDialog({
  open,
  onOpenChange,
  contact,
  onSave,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact?: {
    name: string | null;
    phone: string | null;
    email: string | null;
    identifier: string | null;
    role: string;
  } | null;
  onSave: (data: ContactFormData) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [role, setRole] = useState('customer');

  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setName(contact?.name ?? '');
      setPhone(contact?.phone ?? '');
      setEmail(contact?.email ?? '');
      setIdentifier(contact?.identifier ?? '');
      setRole(contact?.role ?? 'customer');
    }
    onOpenChange(newOpen);
  };

  const canSubmit = (phone.trim() || email.trim()) && !isPending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>
            {contact ? 'Edit contact' : 'Create contact'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="contact-name">Name</Label>
            <Input
              id="contact-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="contact-phone">
                Phone <span className="text-muted-foreground text-xs">*</span>
              </Label>
              <Input
                id="contact-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+65..."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-email">
                Email <span className="text-muted-foreground text-xs">*</span>
              </Label>
              <Input
                id="contact-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                type="email"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            At least phone or email is required.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="contact-identifier">Identifier</Label>
              <Input
                id="contact-identifier"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Optional ID"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-role">Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="contact-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="customer">Customer</SelectItem>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="staff">Staff</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSave({
                ...(name.trim() && { name: name.trim() }),
                ...(phone.trim() && { phone: phone.trim() }),
                ...(email.trim() && { email: email.trim() }),
                ...(identifier.trim() && { identifier: identifier.trim() }),
                role,
              })
            }
            disabled={!canSubmit}
          >
            {isPending
              ? 'Saving...'
              : contact
                ? 'Save changes'
                : 'Create contact'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

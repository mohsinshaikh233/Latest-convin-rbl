'use client';

import Link from 'next/link';
import { C, T } from '../../aurum';
import '../console.css';
import Credentials from '../_components/Credentials';

export default function CredentialsPage() {
  return (
    <main style={{ minHeight: '100dvh', background: C.canvas }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '28px 24px 0' }}>
        <Link href="/console" style={{ ...T.micro, color: C.secondary, textDecoration: 'none' }}>
          ← Back to the console
        </Link>
      </div>
      <Credentials />
    </main>
  );
}

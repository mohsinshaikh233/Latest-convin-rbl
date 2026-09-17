'use client';

import { use } from 'react';
import Report from '../../dashboard/Report';

export default function SharedReport({ params }) {
  const { token } = use(params);
  return <Report shareToken={token} />;
}

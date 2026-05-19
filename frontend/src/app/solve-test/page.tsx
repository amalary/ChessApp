import { Suspense } from 'react';
import SolveTestClient from './solve-test-client';

export default function SolveTestPage() {
  return (
    <Suspense fallback={null}>
      <SolveTestClient />
    </Suspense>
  );
}

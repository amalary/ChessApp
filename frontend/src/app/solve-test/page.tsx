import { Suspense } from 'react';
import SolveTestClient from './solve-test-client';

export default async function SolveTestPage() {
  return (
    <Suspense fallback={null}>
      <SolveTestClient />
    </Suspense>
  );
}

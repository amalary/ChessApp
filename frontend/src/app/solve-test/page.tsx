'use client';

import React, { useState } from 'react';

export default function SolveTestPage() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0] ?? null;
    console.log('handleFileChange, chosen file:', chosen);
    setFile(chosen);
    setResult(null);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('handleSubmit fired');
    setError(null);
    setResult(null);

    if (!file) {
      console.log('No file selected');
      setError('Please choose an image first.');
      return;
    }

    const backendUrl =
      process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://127.0.0.1:8000';
    const token = process.env.NEXT_PUBLIC_AUTH0_TEST_TOKEN;

    if (!token) {
      console.log('No test token found in env');
      setError('Missing NEXT_PUBLIC_AUTH0_TEST_TOKEN in .env.local');
      return;
    }

    const formData = new FormData();
    formData.append('image', file);
    console.log('Sending to backend:', backendUrl + '/solve');

    setLoading(true);
    try {
      const res = await fetch(`${backendUrl}/solve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await res.json();
      console.log('Response from backend:', res.status, data);

      if (!res.ok) {
        setError(
          `Error ${res.status}: ${data.detail || data.error || 'Unknown error'}`
        );
      } else {
        setResult(data);
      }
    } catch (err: any) {
      console.error('Network or fetch error:', err);
      setError(err.message || 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-2xl font-bold">Test /solve Route</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 items-center">
        <label className="flex flex-col items-center gap-2 cursor-pointer">
          <span className="text-sm font-medium">
            Click to choose an image:
          </span>
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="border p-2"
          />
        </label>

        <div className="text-sm">
          Selected file:{' '}
          <span className="font-mono">
            {file ? file.name : 'none'}
          </span>
        </div>

        <button
          type="submit"
          className="px-4 py-2 rounded-md border text-sm"
        >
          {loading ? 'Sending...' : 'Send to /solve'}
        </button>
      </form>

      {error && (
        <pre className="mt-4 text-red-600 text-sm max-w-xl whitespace-pre-wrap">
          {error}
        </pre>
      )}

      {result && (
        <pre className="mt-4 text-sm max-w-xl bg-black/5 p-3 rounded whitespace-pre-wrap">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </main>
  );
}

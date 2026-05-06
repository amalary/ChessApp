import fs from 'node:fs';
import path from 'node:path';

describe('agent route', () => {
  it('redirects to dashboard agent section', () => {
    const filePath = path.resolve(process.cwd(), 'src/app/agent/page.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain("redirect('/dashboard?section=Agent')");
  });
});

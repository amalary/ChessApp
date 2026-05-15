import fs from 'node:fs';
import path from 'node:path';

describe('dashboard agent nav wiring', () => {
  it('includes Agent nav item between Training and Settings', () => {
    const filePath = path.resolve(process.cwd(), 'src/app/dashboard/page.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    const trainingIndex = source.indexOf("{ label: 'Training', icon: Activity }");
    const agentIndex = source.indexOf("{ label: 'Agent', icon: Bot }");
    const settingsIndex = source.indexOf("{ label: 'Settings', icon: Settings }");

    expect(trainingIndex).toBeGreaterThan(-1);
    expect(agentIndex).toBeGreaterThan(trainingIndex);
    expect(settingsIndex).toBeGreaterThan(agentIndex);
  });

  it('renders Agent page section when active', () => {
    const filePath = path.resolve(process.cwd(), 'src/app/dashboard/page.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain("const isAgentView = activeNavLabel === 'Agent';");
    expect(source).toContain(
      'assistantConversationMode={assistantConversationMode}',
    );
  });
});

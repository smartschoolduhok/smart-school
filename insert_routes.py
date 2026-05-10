with open('src/worker.ts', 'r') as f:
    lines = f.readlines()

with open('src/grade-routes.ts', 'r') as f:
    routes = f.read()

idx = None
for i, line in enumerate(lines):
    if 'Serve static files' in line:
        idx = i
        break

if idx is None:
    for i, line in enumerate(lines):
        if "app.use('/assets/" in line:
            idx = i
            break

print('Insertion line:', idx + 1)

if idx is not None:
    new_lines = lines[:idx] + ['\n// ===========================================\n// Phase 4: Grades & Academic Calculations\n// ===========================================\n\n'] + [routes + '\n'] + lines[idx:]
    with open('src/worker.ts', 'w') as f:
        f.writelines(new_lines)
    print('Done, new line count:', len(new_lines))
else:
    print('ERROR: insertion point not found')

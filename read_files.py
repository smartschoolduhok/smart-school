#!/usr/bin/env python3
import re

with open('src/worker.ts', 'r') as f:
    content = f.read()

# Find password hashing logic
idx = content.find('hashPassword')
if idx >= 0:
    print("=== hashPassword function ===")
    print(content[idx:idx+800])
else:
    print("hashPassword not found")

print("\n" + "="*60 + "\n")

# Find verifyPassword
idx = content.find('verifyPassword')
if idx >= 0:
    print("=== verifyPassword function ===")
    print(content[idx:idx+800])
else:
    print("verifyPassword not found")

print("\n" + "="*60 + "\n")

# Find /api/schools/:id route
idx = content.find("app.get('/api/schools/:id'")
if idx >= 0:
    print("=== /api/schools/:id route ===")
    print(content[idx:idx+600])
else:
    print("/api/schools/:id not found")

print("\n" + "="*60 + "\n")

# Find /api/users routes section
idx = content.find("// ===========================================\n// API ROUTES: Users")
if idx >= 0:
    print("=== Users routes section ===")
    print(content[idx:idx+2000])
else:
    print("Users routes section not found")

print("\n" + "="*60 + "\n")

# Find all requireAuth middleware
matches = list(re.finditer(r'requireAuth|requireSameSchoolOrAdmin', content))
print(f"=== Middleware references ({len(matches)} found) ===")
for m in matches[:20]:
    line_start = content.rfind('\n', 0, m.start()) + 1
    line_end = content.find('\n', m.start())
    print(f"  {content[line_start:line_end]}")

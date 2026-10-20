"""Isolated validation snapshot of actual user data and Git checkouts. No generated project data."""
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys

source = Path(sys.argv[1]).resolve()
target = Path(sys.argv[2]).resolve()
if target.exists():
    raise SystemExit('The validation destination must be new; existing data is never overwritten.')
target.mkdir(parents=True)
original = sqlite3.connect((source / 'skaro.db').as_uri() + '?mode=ro', uri=True)
snapshot = sqlite3.connect(target / 'skaro.db')
original.backup(snapshot)
original.close()
mapping = [(str(source), str(target))]

for project_id, raw in snapshot.execute('SELECT id,path FROM projects').fetchall():
    root = Path(raw)
    if not root.is_dir():
        continue
    destination = target / 'p' / project_id[:8]
    destination.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(['git', '-c', 'core.longpaths=true', 'clone', '--quiet', '--shared', '--no-hardlinks', str(root), str(destination)], check=True)
    refs = subprocess.check_output(['git', '-C', str(root), 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'], text=True)
    for line in refs.splitlines():
        ref, sha = line.split(' ', 1)
        subprocess.run(['git', '-C', str(destination), 'update-ref', ref, sha], check=True)
    # Overlay actual working-copy edits and untracked files, using Git's own ignore rules.
    paths = subprocess.check_output(['git', '-C', str(root), 'diff', '--name-only', '-z', 'HEAD']).split(b'\0')
    paths += subprocess.check_output(['git', '-C', str(root), 'ls-files', '--others', '--exclude-standard', '-z']).split(b'\0')
    for entry in set(paths):
        if not entry:
            continue
        relative = Path(os.fsdecode(entry))
        current = root / relative
        copied = destination / relative
        if current.is_file():
            copied.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(current, copied)
        elif not current.exists() and copied.is_file():
            copied.unlink()
    if (root / '.skaro').is_dir():
        shutil.copytree(root / '.skaro', destination / '.skaro', dirs_exist_ok=True)
    snapshot.execute('UPDATE projects SET path=? WHERE id=?', (str(destination), project_id))
    mapping.append((str(root), str(destination)))
    print(json.dumps({'project': project_id, 'snapshot': str(destination)}), flush=True)

for name in ['chats', 'runs', 'attachments', 'imports']:
    if (source / name).exists():
        shutil.copytree(source / name, target / name)
if (source / 'integrations').exists():
    shutil.copytree(source / 'integrations', target / 'integrations', ignore=shutil.ignore_patterns('checkout'))

def relocate(value):
    if isinstance(value, str):
        for before, after in mapping:
            if value == before or value.startswith(before + '\\') or value.startswith(before + '/'):
                return after + value[len(before):]
        return value
    if isinstance(value, list):
        return [relocate(item) for item in value]
    if isinstance(value, dict):
        return {key: relocate(item) for key, item in value.items()}
    return value

for key, text in snapshot.execute('SELECT key,value FROM settings').fetchall():
    value = json.loads(text)
    changed = relocate(value)
    if changed != value:
        snapshot.execute('UPDATE settings SET value=? WHERE key=?', (json.dumps(changed, ensure_ascii=False), key))
for run_id, path in snapshot.execute('SELECT id,worktree FROM runs WHERE worktree IS NOT NULL').fetchall():
    snapshot.execute('UPDATE runs SET worktree=? WHERE id=?', (relocate(path), run_id))
snapshot.commit()
snapshot.close()
from isolate_profile_environments import isolate
isolate(target)
print(json.dumps({'profile': str(target), 'source_unchanged': True}), flush=True)

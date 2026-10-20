/** Counts and revision change in the same transaction as each canonical chat mutation. */
export const CHAT_CATALOG_MIGRATION = `
CREATE INDEX chats_catalog_order ON chats(project_id,archived,task_id,updated_at);
CREATE TABLE chat_catalog_counts (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO chat_catalog_counts(project_id,active,archived)
  SELECT project_id,SUM(archived=0),SUM(archived=1) FROM chats
  WHERE task_id IS NULL GROUP BY project_id;
CREATE TRIGGER chat_catalog_insert AFTER INSERT ON chats WHEN NEW.task_id IS NULL BEGIN
  INSERT INTO chat_catalog_counts(project_id,active,archived,revision)
    VALUES(NEW.project_id,NEW.archived=0,NEW.archived=1,1)
    ON CONFLICT(project_id) DO UPDATE SET active=active+(NEW.archived=0),
      archived=archived+(NEW.archived=1),revision=revision+1;
END;
CREATE TRIGGER chat_catalog_delete AFTER DELETE ON chats WHEN OLD.task_id IS NULL BEGIN
  UPDATE chat_catalog_counts SET active=active-(OLD.archived=0),
    archived=archived-(OLD.archived=1),revision=revision+1 WHERE project_id=OLD.project_id;
END;
CREATE TRIGGER chat_catalog_update AFTER UPDATE ON chats BEGIN
  UPDATE chat_catalog_counts SET active=active-(OLD.archived=0),
    archived=archived-(OLD.archived=1),revision=revision+1
    WHERE project_id=OLD.project_id AND OLD.task_id IS NULL;
  INSERT INTO chat_catalog_counts(project_id,active,archived,revision)
    SELECT NEW.project_id,NEW.archived=0,NEW.archived=1,1 WHERE NEW.task_id IS NULL
    ON CONFLICT(project_id) DO UPDATE SET active=active+(NEW.archived=0),
      archived=archived+(NEW.archived=1),revision=revision+1;
END;
`;

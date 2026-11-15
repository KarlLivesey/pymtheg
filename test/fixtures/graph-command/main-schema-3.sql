CREATE TABLE graph_candidates(link TEXT NOT NULL REFERENCES graph_links(id) ON DELETE CASCADE,symbol TEXT NOT NULL REFERENCES graph_symbols(id) ON DELETE CASCADE,kind TEXT NOT NULL,PRIMARY KEY(link,symbol));
CREATE TABLE graph_contexts(path TEXT PRIMARY KEY,body TEXT NOT NULL);
CREATE TABLE graph_files(path TEXT PRIMARY KEY,body TEXT NOT NULL,status TEXT NOT NULL);
CREATE TABLE graph_links(id TEXT PRIMARY KEY,file TEXT NOT NULL REFERENCES graph_files(path) ON DELETE CASCADE,source TEXT REFERENCES graph_symbols(id) ON DELETE CASCADE,target TEXT REFERENCES graph_symbols(id) ON DELETE SET NULL,kind TEXT NOT NULL,body TEXT NOT NULL,module TEXT NOT NULL,origin TEXT NOT NULL,resolution TEXT NOT NULL);
CREATE TABLE graph_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE graph_parse_failures(path TEXT PRIMARY KEY REFERENCES graph_files(path) ON DELETE CASCADE,hash TEXT,module TEXT,version TEXT);
CREATE TABLE graph_symbols(id TEXT PRIMARY KEY,file TEXT NOT NULL REFERENCES graph_files(path) ON DELETE CASCADE,name TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL);
CREATE INDEX graph_candidate_symbol ON graph_candidates(symbol,kind,link);
CREATE INDEX graph_link_file ON graph_links(file);
CREATE INDEX graph_link_module ON graph_links(module);
CREATE INDEX graph_link_resolution ON graph_links(resolution);
CREATE INDEX graph_link_source ON graph_links(source,kind);
CREATE INDEX graph_link_target ON graph_links(target,kind);
CREATE INDEX graph_symbol_file ON graph_symbols(file,id);
CREATE INDEX graph_symbol_kind ON graph_symbols(kind,id);
CREATE INDEX graph_symbol_kind_file ON graph_symbols(kind,file,id);
CREATE INDEX graph_symbol_name ON graph_symbols(name,id);
CREATE INDEX graph_symbol_name_file ON graph_symbols(name,file,id);
CREATE INDEX graph_symbol_name_kind ON graph_symbols(name,kind,id);
CREATE INDEX graph_symbol_name_kind_file ON graph_symbols(name,kind,file,id);
CREATE TRIGGER graph_candidate_added AFTER INSERT ON graph_candidates BEGIN
          UPDATE graph_links SET resolution='ambiguous' WHERE id=NEW.link AND target IS NULL AND resolution!='ambiguous';
        END;
CREATE TRIGGER graph_candidate_removed AFTER DELETE ON graph_candidates BEGIN
          UPDATE graph_links SET resolution=CASE WHEN target IS NOT NULL THEN 'resolved'
            WHEN EXISTS(SELECT 1 FROM graph_candidates WHERE link=OLD.link) THEN 'ambiguous' ELSE 'unresolved' END
            WHERE id=OLD.link AND resolution IS NOT CASE WHEN target IS NOT NULL THEN 'resolved'
            WHEN EXISTS(SELECT 1 FROM graph_candidates WHERE link=OLD.link) THEN 'ambiguous' ELSE 'unresolved' END;
        END;
CREATE TRIGGER graph_target_changed AFTER UPDATE OF target ON graph_links
        WHEN OLD.target IS NOT NEW.target BEGIN
          UPDATE graph_links SET resolution=CASE WHEN NEW.target IS NOT NULL THEN 'resolved'
            WHEN EXISTS(SELECT 1 FROM graph_candidates WHERE link=NEW.id) THEN 'ambiguous' ELSE 'unresolved' END WHERE id=NEW.id;
        END;

INSERT INTO graph_meta VALUES ('schema','3');

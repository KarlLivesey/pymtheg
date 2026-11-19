# C-10 hand-check of newly definite links

The lowest-hash newly definite links per mechanism (seed `c10`, from
`compare.mjs`) in the second candidate sweep, read against the pinned
source. The corpus is not built; each target was checked by reading the
receiver or binding back to its declaration and, for methods, the impl and
every trait in scope. Verdict for all 100: correct.

## Local bindings

| Repository | Site | Reference | Code | Target |
| --- | --- | --- | --- | --- |
| cberner/redb | `src/tree_store/page_store/page_manager.rs:1984` | `hint` | `let mem = self.storage.read(range.start, len, hint)?;` | `src/tree_store/page_store/page_manager.rs:1975 method get_page` |
| helix-editor/helix | `helix-core/tests/indent.rs:200` | `syntax` | `treesitter_indent_for_pos(query, &syntax, &loader, 4, 4, doc.slice(..), 0, 11, true)` | `helix-core/tests/indent.rs:190 function test_new_line_after_trailing_comment_with_crlf` |
| helix-editor/helix | `helix-stdx/src/path.rs:241` | `windows` | `let sep = if windows { r"[/\\]" } else { "/" };` | `helix-stdx/src/path.rs:226 function compile_path_regex` |
| clap-rs/clap | `clap_complete_nushell/src/lib.rs:52` | `completions` | `generate_completion(&mut completions, cmd, false);` | `clap_complete_nushell/src/lib.rs:43 method try_generate` |
| helix-editor/helix | `helix-term/src/application.rs:759` | `cx` | `.handle_event(&Event::Resize(width, height), &mut cx)` | `helix-term/src/application.rs:700 method handle_terminal_events` |
| helix-editor/helix | `helix-term/src/ui/markdown.rs:199` | `get_theme` | `let text_style = get_theme(Self::TEXT_STYLE);` | `helix-term/src/ui/markdown.rs:172 method parse` |
| ratatui/ratatui | `examples/apps/demo2/src/destroy.rs:92` | `area` | `let area = centered_rect(area, logo_text.width() as u16, logo_text.height() as u16);` | `examples/apps/demo2/src/destroy.rs:78 function text` |
| helix-editor/helix | `helix-core/src/uri.rs:29` | `path` | `Self::File(path) => Some(path),` | `helix-core/src/uri.rs:27 method as_path` |
| clap-rs/clap | `clap_builder/src/builder/command.rs:1055` | `self` | `let usage = Usage::new(self);` | `clap_builder/src/builder/command.rs:1051 method write_help` |
| helix-editor/helix | `helix-term/src/ui/completion.rs:330` | `pattern` | `pattern,` | `helix-term/src/ui/completion.rs:323 method score` |
| ratatui/ratatui | `ratatui/tests/terminal.rs:43` | `backend` | `let mut terminal = Terminal::new(backend)?;` | `ratatui/tests/terminal.rs:41 function terminal_draw_increments_frame_count` |
| helix-editor/helix | `helix-core/src/match_brackets.rs:226` | `ch` | `.find(\|(open, close)\| *open == ch \|\| *close == ch)` | `helix-core/src/match_brackets.rs:223 function get_pair` |
| ratatui/ratatui | `ratatui-widgets/examples/block.rs:75` | `area` | `frame.render_widget(block, area);` | `ratatui-widgets/examples/block.rs:70 function render_custom_bordered_block` |
| cberner/redb | `src/tree_store/btree_cursor.rs:2358` | `direction` | `match direction {` | `src/tree_store/btree_cursor.rs:2346 method entry_in_range` |
| cberner/redb | `src/tree_store/btree_base.rs:1503` | `i` | `let key_end = accessor.key_end(i).unwrap();` | `src/tree_store/btree_base.rs:1497 method remove` |
| fjall-rs/fjall | `examples_disabled/tx-blob-cas/src/main.rs:247` | `big_blob_3` | `cas.insert(b"b", &big_blob_3)?;` | `examples_disabled/tx-blob-cas/src/main.rs:166 function main` |
| helix-editor/helix | `helix-view/src/handlers/word_index.rs:312` | `old_text` | `this.update_document(&old_text, &text, &changes, &cancel);` | `helix-view/src/handlers/word_index.rs:292 method run` |
| helix-editor/helix | `helix-core/src/transaction.rs:650` | `data` | `let tendril = process_change(from, to, data);` | `helix-core/src/transaction.rs:640 method change_ignore_overlapping` |
| helix-editor/helix | `helix-view/src/input.rs:516` | `button` | `match button {` | `helix-view/src/input.rs:515 method from` |
| helix-editor/helix | `helix-loader/src/lib.rs:228` | `merge_depth` | `if merge_depth > 0 {` | `helix-loader/src/lib.rs:199 function merge_toml_values` |
| cberner/redb | `src/tree_store/page_store/active_transactions.rs:19` | `low` | `if query(bytes(low, low))? {` | `src/tree_store/page_store/active_transactions.rs:11 function lowest_held` |
| cberner/redb | `src/tree_store/table_tree.rs:495` | `name` | `&name,` | `src/tree_store/table_tree.rs:465 method create_table_and_flush_table_root` |
| cberner/redb | `src/tree_store/page_store/layout.rs:160` | `region_header_pages` | `let full_region_layout = RegionLayout::new(page_capacity, region_header_pages, page_size);` | `src/tree_store/page_store/layout.rs:154 method calculate` |
| helix-editor/helix | `helix-view/src/view.rs:510` | `width` | `let config = config.inline_diagnostics.prepare(width, enable_cursor_line);` | `helix-view/src/view.rs:452 method text_annotations` |
| tokio-rs/axum | `axum/src/routing/path_router.rs:265` | `endpoint` | `.map(\|endpoint\| match endpoint {` | `axum/src/routing/path_router.rs:261 method with_state` |
| cberner/redb | `src/multimap_table.rs:1033` | `upper` | `self.range_in_bounds(lower, upper)` | `src/multimap_table.rs:1028 method range` |
| serde-rs/serde | `serde_derive/src/internals/receiver.rs:123` | `bound` | `self.visit_type_param_bound_mut(bound);` | `serde_derive/src/internals/receiver.rs:107 method visit_type_mut_impl` |
| clap-rs/clap | `clap_builder/src/builder/arg_group.rs:93` | `id` | `Self::default().id(id)` | `clap_builder/src/builder/arg_group.rs:92 method new` |
| fjall-rs/fjall | `src/keyspace/mod.rs:1190` | `memtable_size` | `self.maintenance(memtable_size);` | `src/keyspace/mod.rs:1142 method remove_weak` |
| clap-rs/clap | `clap_builder/src/builder/str.rs:325` | `state` | `self.as_str().hash(state);` | `clap_builder/src/builder/str.rs:324 method hash` |

## Generic parameters

| Repository | Site | Reference | Code | Target |
| --- | --- | --- | --- | --- |
| crossbeam-rs/crossbeam | `crossbeam-skiplist/src/base.rs:1019` | `C` | `) -> RefEntry<'_, K, V, C>` | `crossbeam-skiplist/src/base.rs:533 impl impl<K,V,C> SkipList<K,V,C>` |
| cberner/redb | `src/tree_store/btree_base.rs:473` | `V` | `impl<V: MutInPlaceValue + 'static> AsMut<V::BaseRefType> for AccessGuardMutInPlace<'_, V> ` | `src/tree_store/btree_base.rs:473 impl impl<V:MutInPlaceValue+'static> AsMut<V::BaseRefType` |
| tokio-rs/axum | `axum/src/extract/ws.rs:949` | `B` | `B: Into<Bytes>,` | `axum/src/extract/ws.rs:947 method binary` |
| tokio-rs/axum | `axum/src/boxed.rs:148` | `E` | `E: 'static,` | `axum/src/boxed.rs:145 impl impl<S,E,E2> ErasedIntoRoute<S,E2> for Map<S,E,E2>` |
| cberner/redb | `src/tree_store/btree_cursor.rs:2118` | `K` | `fn peek(&mut self, direction: Direction) -> Result<Option<EntryRef<'_, K, V>>> {` | `src/tree_store/btree_cursor.rs:2027 impl impl<'a,K:Key+'static,V:Value+'static> RangeMut<'` |
| crossbeam-rs/crossbeam | `crossbeam-skiplist/src/set.rs:639` | `R` | `R: RangeBounds<Q>,` | `crossbeam-skiplist/src/set.rs:636 impl impl<Q,R,T,C> DoubleEndedIterator for Range<'_,Q,R,` |
| serde-rs/serde | `test_suite/tests/test_gen.rs:179` | `T` | `T(T),` | `test_suite/tests/test_gen.rs:178 enum RecursiveGenericB` |
| ratatui/ratatui | `ratatui/src/init.rs:325` | `R` | `F: FnOnce(&mut DefaultTerminal) -> R,` | `ratatui/src/init.rs:323 function run` |
| cberner/redb | `fuzz/fuzz_targets/common.rs:36` | `MAX` | `impl<const MIN: u64, const MAX: u64> Arbitrary<'_> for U64Between<MIN, MAX> {` | `fuzz/fuzz_targets/common.rs:36 impl impl<constMIN:u64,constMAX:u64> Arbitrary<'_> for U64B` |
| tokio-rs/axum | `axum-extra/src/handler/or.rs:25` | `Lt` | `L: HandlerCallWithExtractors<Lt, S> + Send + 'static,` | `axum-extra/src/handler/or.rs:23 impl impl<S,L,R,Lt,Rt> HandlerCallWithExtractors<Either<Lt` |
| serde-rs/serde | `serde/src/private/ser.rs:802` | `E` | `impl<E> ser::SerializeTuple for SerializeTuple<E>` | `serde/src/private/ser.rs:802 impl impl<E> ser::SerializeTuple for SerializeTuple<E>` |
| cberner/redb | `src/tree_store/btree.rs:776` | `F` | `mut predicate: F,` | `src/tree_store/btree.rs:774 method retain_in_bounds` |
| cberner/redb | `src/table.rs:1061` | `V` | `) -> Result<Cursor<'_, K, V>> {` | `src/table.rs:1020 impl impl<K:Key+'static,V:Value+'static> ReadableTable<K,V> for ReadOnly` |
| crossbeam-rs/crossbeam | `crossbeam-skiplist/src/map.rs:634` | `C` | `C: Comparator<K>,` | `crossbeam-skiplist/src/map.rs:632 impl impl<K,V,C> Entry<'_,K,V,C>` |
| crossbeam-rs/crossbeam | `crossbeam-skiplist/src/map.rs:614` | `V` | `pub fn value(&self) -> &V {` | `crossbeam-skiplist/src/map.rs:601 impl impl<'a,K,V,C> Entry<'a,K,V,C>` |
| tokio-rs/axum | `axum/src/middleware/from_extractor.rs:111` | `S` | `state: S,` | `axum/src/middleware/from_extractor.rs:110 struct FromExtractorLayer` |
| cberner/redb | `tests/cursor_tests.rs:687` | `T` | `fn nearest_below<T: ReadableTable<u64, u64>>(table: &T, key: u64) -> Option<u64> {` | `tests/cursor_tests.rs:687 function nearest_below` |
| tokio-rs/axum | `examples/diesel-postgres/src/main.rs:126` | `E` | `E: std::error::Error,` | `examples/diesel-postgres/src/main.rs:124 function internal_error` |
| helix-editor/helix | `helix-term/src/ui/statusline.rs:448` | `F` | `F: Fn(&mut RenderContext<'a>, Span<'a>) + Copy,` | `helix-term/src/ui/statusline.rs:446 function render_file_name` |
| serde-rs/serde | `serde_core/src/de/value.rs:152` | `E` | `impl<'de, E> de::Deserializer<'de> for UnitDeserializer<E>` | `serde_core/src/de/value.rs:152 impl impl<'de,E> de::Deserializer<'de> for UnitDeserializer` |
| cberner/redb | `src/tree_store/btree_cursor.rs:1892` | `K` | `pub(crate) fn prev(&mut self) -> Result<Option<(AccessGuard<'_, K>, AccessGuard<'_, V>)>> ` | `src/tree_store/btree_cursor.rs:1773 impl impl<'a,K:Key+'static,V:Value+'static> BtreeCurso` |
| helix-editor/helix | `helix-term/src/commands.rs:1195` | `F` | `fn move_word_impl<F>(cx: &mut Context, move_fn: F)` | `helix-term/src/commands.rs:1195 function move_word_impl` |
| serde-rs/serde | `serde_core/src/de/value.rs:1514` | `V` | `fn deserialize_tuple<V>(self, len: usize, visitor: V) -> Result<V::Value, Self::Error>` | `serde_core/src/de/value.rs:1514 method deserialize_tuple` |
| crossbeam-rs/crossbeam | `crossbeam-epoch/src/atomic.rs:161` | `T` | `impl<T> Pointable for T {` | `crossbeam-epoch/src/atomic.rs:161 impl impl<T> Pointable for T` |
| cberner/redb | `src/table.rs:224` | `KR` | `KR: Borrow<K::SelfType<'a>> + 'a,` | `src/table.rs:218 method extract_from_if` |
| ratatui/ratatui | `ratatui-core/src/backend/test.rs:88` | `Lines` | `pub fn with_lines<'line, Lines>(lines: Lines) -> Self` | `ratatui-core/src/backend/test.rs:88 method with_lines` |
| serde-rs/serde | `test_suite/tests/test_macros.rs:55` | `C` | `_Map2 { a: i8, b: B, c: &'a C, d: &'a mut D },` | `test_suite/tests/test_macros.rs:44 enum SerEnum` |
| serde-rs/serde | `serde_core/src/de/value.rs:473` | `E` | `impl<'de, 'a, E> de::Deserializer<'de> for StrDeserializer<'a, E>` | `serde_core/src/de/value.rs:473 impl impl<'de,'a,E> de::Deserializer<'de> for StrDeserializ` |
| serde-rs/serde | `serde_core/src/ser/impossible.rs:204` | `T` | `fn serialize_field<T>(&mut self, key: &'static str, value: &T) -> Result<(), Error>` | `serde_core/src/ser/impossible.rs:204 method serialize_field` |
| tokio-rs/axum | `axum/src/middleware/map_response.rs:159` | `T` | `impl<F, S, T> Clone for MapResponseLayer<F, S, T>` | `axum/src/middleware/map_response.rs:159 impl impl<F,S,T> Clone for MapResponseLayer<F,S,T>` |

## Methods, inferred receiver type

| Repository | Site | Reference | Code | Target |
| --- | --- | --- | --- | --- |
| ratatui/ratatui | `examples/apps/demo2/src/tabs/weather.rs:128` | `Style::new().fg` | `.bar_style(Style::new().fg(bg))` | `ratatui-core/src/style.rs:416 method fg` |
| clap-rs/clap | `clap_builder/src/output/help_template.rs:724` | `self.writer.push_styled` | `self.writer.push_styled(&help);` | `clap_builder/src/builder/styled_str.rs:143 method push_styled` |
| helix-editor/helix | `helix-view/src/view.rs:539` | `inner.top` | `if row < inner.top() \|\| row >= inner.bottom() {` | `helix-view/src/graphics.rs:152 method top` |
| BurntSushi/ripgrep | `crates/ignore/src/dir.rs:1681` | `td.path` | `let (ignore, err) = ib.add_child(td.path().join("linked-worktree"));` | `crates/ignore/src/lib.rs:545 method path` |
| BurntSushi/ripgrep | `crates/ignore/src/walk.rs:2613` | `td.path` | `wfile(td.path().join("a/b/foo"), "");` | `crates/ignore/src/lib.rs:545 method path` |
| BurntSushi/ripgrep | `crates/searcher/src/searcher/glue.rs:950` | `SearcherTester::new(SHERLOCK, " a ") .after_context(1) .before_context(1) .line_number(tru` | `SearcherTester::new(SHERLOCK, " a ")` | `crates/searcher/src/testutil.rs:322 method expected_no_line_number` |
| BurntSushi/ripgrep | `crates/ignore/src/dir.rs:1471` | `td.path` | `wfile(td.path().join(name), "blocked\n!allowed");` | `crates/ignore/src/lib.rs:545 method path` |
| clap-rs/clap | `clap_builder/src/output/help_template.rs:659` | `self.writer.push_styled` | `self.writer.push_styled(&help);` | `clap_builder/src/builder/styled_str.rs:143 method push_styled` |
| clap-rs/clap | `clap_complete/src/engine/complete.rs:605` | `candidate .help(subcommand.get_about().cloned()) .id(Some(format!("command::{}", subcomman` | `candidate` | `clap_complete/src/engine/candidate.rs:44 method tag` |
| helix-editor/helix | `helix-tui/src/buffer.rs:694` | `area.area` | `self.content.resize(area.area(), cell.clone());` | `helix-view/src/graphics.rs:137 method area` |
| BurntSushi/ripgrep | `crates/ignore/src/walk.rs:2316` | `td.path` | `wfile(td.path().join(custom_ignore), "foo");` | `crates/ignore/src/lib.rs:545 method path` |
| clap-rs/clap | `clap_builder/src/builder/command.rs:1324` | `self .unset_global_setting(AppSettings::ColorAuto) .unset_global_setting` | `let cmd = self` | `clap_builder/src/builder/command.rs:2342 method unset_global_setting` |
| BurntSushi/ripgrep | `crates/ignore/src/walk.rs:2374` | `td.path` | `wfile(td.path().join("a/bar"), "");` | `crates/ignore/src/lib.rs:545 method path` |
| clap-rs/clap | `clap_builder/src/parser/parser.rs:727` | `self.cmd._build_subcommand` | `if let Some(sc) = self.cmd._build_subcommand(sc_name) {` | `clap_builder/src/builder/command.rs:4491 method _build_subcommand` |
| ratatui/ratatui | `ratatui-core/tests/rect.rs:100` | `a.intersection` | `let inter = a.intersection(b);` | `ratatui-core/src/layout/rect.rs:322 method intersection` |
| tree-sitter/tree-sitter | `crates/generate/src/build_tables/build_parse_table.rs:1278` | `self .str_pool .resolve` | `let variable_name = self` | `crates/generate/src/strpool.rs:118 method resolve` |
| clap-rs/clap | `clap_builder/src/output/usage.rs:106` | `self.cmd.is_flatten_help_set` | `if self.cmd.has_visible_subcommands() && self.cmd.is_flatten_help_set() {` | `clap_builder/src/builder/command.rs:3835 method is_flatten_help_set` |
| crossbeam-rs/crossbeam | `crossbeam-skiplist/src/base.rs:1762` | `n.as_tower` | `.next_node(n.as_tower(), Bound::Excluded(&n.key), guard)?;` | `crossbeam-skiplist/src/base.rs:365 method as_tower` |
| cberner/redb | `tests/integration_tests.rs:1480` | `txn.commit` | `txn.commit().unwrap();` | `src/transactions.rs:1755 method commit` |
| ratatui/ratatui | `ratatui-core/src/symbols/merge.rs:429` | `self.down.merge` | `self.down.merge(other.down),` | `ratatui-core/src/symbols/merge.rs:494 method merge` |
| BurntSushi/ripgrep | `crates/ignore/src/overrides.rs:181` | `self.builder.allow_unclosed_class` | `self.builder.allow_unclosed_class(yes);` | `crates/ignore/src/gitignore.rs:574 method allow_unclosed_class` |
| cberner/redb | `src/transactions.rs:2205` | `TransactionId::new(savepoint_horizon).next` | `free_until = free_until.min(TransactionId::new(savepoint_horizon).next());` | `src/transaction_tracker.rs:28 method next` |
| BurntSushi/ripgrep | `crates/ignore/src/dir.rs:1220` | `td.path` | `wfile(td.path().join(".gitignore"), "foo\n!bar");` | `crates/ignore/src/lib.rs:545 method path` |
| BurntSushi/ripgrep | `crates/searcher/src/searcher/glue.rs:1020` | `SearcherTester::new(SHERLOCK, " a ") .before_context(1) .line_number(false) .invert_match` | `SearcherTester::new(SHERLOCK, " a ")` | `crates/searcher/src/testutil.rs:392 method invert_match` |
| clap-rs/clap | `clap_builder/src/output/usage.rs:291` | `self.cmd.find_group` | `if self.cmd.find_group(req).is_some() {` | `clap_builder/src/builder/command.rs:5022 method find_group` |
| ratatui/ratatui | `ratatui-core/src/style.rs:750` | `Self::new().fg` | `Self::new().fg(fg).add_modifier(modifier)` | `ratatui-core/src/style.rs:416 method fg` |
| clap-rs/clap | `clap_builder/src/output/help_template.rs:899` | `self.writer.push_str` | `self.writer.push_str("\n\n");` | `clap_builder/src/builder/styled_str.rs:46 method push_str` |
| clap-rs/clap | `clap_builder/src/parser/validator.rs:139` | `self.cmd.unroll_args_in_group` | `self.cmd.unroll_args_in_group(c_id)` | `clap_builder/src/builder/command.rs:5053 method unroll_args_in_group` |
| ratatui/ratatui | `examples/apps/custom-widget/src/main.rs:105` | `Style::new().bg(background).fg` | `buf.set_style(area, Style::new().bg(background).fg(text));` | `ratatui-core/src/style.rs:416 method fg` |
| cberner/redb | `tests/integration_tests.rs:1253` | `txn.commit` | `txn.commit().unwrap();` | `src/transactions.rs:1755 method commit` |

## Methods, written receiver type (autoref step)

| Repository | Site | Reference | Code | Target |
| --- | --- | --- | --- | --- |
| BurntSushi/ripgrep | `crates/searcher/src/searcher/glue.rs:128` | `self.byte_count` | `let byte_count = self.byte_count();` | `crates/searcher/src/searcher/glue.rs:133 method byte_count` |
| BurntSushi/ripgrep | `crates/searcher/src/searcher/glue.rs:181` | `self.sink_matched` | `self.sink_matched(&last_match)?;` | `crates/searcher/src/searcher/glue.rs:299 method sink_matched` |
| BurntSushi/ripgrep | `crates/searcher/src/searcher/glue.rs:42` | `self.consume_remaining` | `self.consume_remaining();` | `crates/searcher/src/searcher/glue.rs:53 method consume_remaining` |
| BurntSushi/ripgrep | `crates/ignore/src/incremental.rs:518` | `mat.is_ignore` | `let should_descend = is_dir && !mat.is_ignore();` | `crates/ignore/src/lib.rs:437 method is_ignore` |
| BurntSushi/ripgrep | `crates/ignore/src/lib.rs:381` | `err.is_io` | `if !err.is_io() {` | `crates/ignore/src/lib.rs:173 method is_io` |
| BurntSushi/ripgrep | `crates/searcher/src/searcher/glue.rs:40` | `self.fill` | `while self.fill()? {` | `crates/searcher/src/searcher/glue.rs:58 method fill` |
| BurntSushi/ripgrep | `crates/searcher/src/searcher/glue.rs:180` | `self.sink_context` | `if self.sink_context(&last_match)? {` | `crates/searcher/src/searcher/glue.rs:311 method sink_context` |
| BurntSushi/ripgrep | `crates/ignore/src/lib.rs:485` | `self.is_none` | `if self.is_none() { other } else { self }` | `crates/ignore/src/lib.rs:429 method is_none` |
| BurntSushi/ripgrep | `crates/searcher/src/searcher/glue.rs:174` | `self.sink` | `keepgoing = self.sink()?;` | `crates/searcher/src/searcher/glue.rs:208 method sink` |
| BurntSushi/ripgrep | `crates/searcher/src/searcher/glue.rs:203` | `self.byte_count` | `let byte_count = self.byte_count();` | `crates/searcher/src/searcher/glue.rs:345 method byte_count` |

# Requirements Document

## Introduction

This feature defines the **dependency graph parser** of the RepoHIVE Hierarchical Codebase Indexing Framework. It is the first stage of the engine pipeline (`parse → group → view`) and the Review 1 deliverable. Its purpose is to read a local Java project from disk, parse every Java source file into a transient per-file Abstract Syntax Tree (AST) using Tree-Sitter, **stitch** those per-file ASTs into a single cross-file dependency graph, and emit that graph as one `graph.json` file conforming exactly to the shared JSON contract consumed by the grouping algorithm.

The defining responsibility is **cross-file stitching**: Tree-Sitter alone produces only an isolated AST per file. The novelty and the work of this parser is to resolve references *across* files — connecting an `import`, a type usage, or a method call in one file to the file, class, or function it refers to in another — and to express those resolved references as directed, weighted dependency edges. The parser is strictly a producer of the dependency graph; it is **not** the grouping algorithm, it does not assess structural quality, and it does not build a hierarchy. Those concerns belong to the downstream core spec (`hierarchical-repository-grouping`).

The output of the parser is a single `graph.json` file whose shape matches the `GraphNode` and `DependencyEdge` interfaces defined in the RepoHIVE JSON contract (`steering/architecture.md` and the core spec's Data Models section). This contract is the **universal seam** of the engine: the parser writes it and every downstream consumer reads it, so the graph must conform to the contract exactly and without modification so that the grouping algorithm can ingest it with zero rework.

This spec scopes the parser only. The core scope is reading a Java project directory, per-file AST extraction of file, class, and function nodes, cross-file stitching into import dependency edges, frequency-signal computation on those edges, deterministic canonical ordering, and serialization to a single contract-conforming `graph.json`. The supporting scope comprises input validation and error handling. It explicitly excludes the grouping algorithm, structural-quality assessment, hierarchy assembly, blast radius analysis, the JSON index file set, and visualization — all of which are downstream concerns.

**Phase-1 simplification (explicit scope note).** The three frequency signals carried by every dependency edge — `importFrequency`, `methodCallFrequency`, and `sharedTypeCount` — are part of the contract **shape** from day one, but their **richness** is deliberately staged. In Phase 1 these signals may be computed as simple counts: `importFrequency` as the number of import-based references from the source to the target, while `methodCallFrequency` and `sharedTypeCount` may start at zero or a basic count. The contract field is always present and always a finite, non-negative number; the precision of the underlying measurement sharpens in later phases without any change to the contract or to downstream consumers. This document states each Phase-1 simplification explicitly at the requirement that introduces it.

**Language and ecosystem scope.** Phase 1 targets **Java** source files exclusively, parsed with the Tree-Sitter Java grammar. The node and edge data model is intentionally general so that additional languages can be added later without changing the contract, but multi-language parsing is out of scope for this spec.

## Glossary

- **Parser_System**: The overall subsystem that reads a Java project directory, stitches per-file ASTs into a cross-file dependency graph, and emits the `graph.json` output file. The umbrella component referenced where a single named actor is required.
- **Project_Directory**: The path to a local directory on disk that the user supplies as input; the root of the Java project to be parsed.
- **Source_File_Collector**: The component that recursively discovers the set of Java source files within the Project_Directory that are eligible for parsing.
- **Java_Source_File**: A regular file within the Project_Directory whose name ends with the `.java` extension and which is therefore eligible for parsing.
- **AST_Extractor**: The component that parses a single Java_Source_File with the Tree-Sitter Java grammar into a transient per-file Abstract Syntax Tree and extracts the file, class, and function declarations it contains.
- **Abstract_Syntax_Tree (AST)**: The transient, in-memory syntax tree produced by Tree-Sitter for a single Java_Source_File. The AST is held one file at a time and discarded after extraction; it is never persisted.
- **Graph_Node**: A vertex of the dependency graph representing a code entity — a file, a class, or a function — conforming to the `GraphNode` interface of the JSON contract.
- **Node_Kind**: The category of a Graph_Node, one of `file`, `class`, or `function`.
- **Package_Path**: The declared Java package of a code entity (for example, `com.example.service`), recorded on a Graph_Node as the `packagePath` field where a package is declared.
- **Directory_Path**: The path of the directory containing a Graph_Node's defining file, relative to the Project_Directory, recorded on a Graph_Node as the `directoryPath` field.
- **Defining_File**: The Java_Source_File in which a class or function Graph_Node is declared, recorded on that Graph_Node as the `definedInFile` field.
- **Symbol_Table**: The in-memory index, built during parsing, that maps resolvable Java names (fully qualified type names, package members, declared classes and functions) to the Graph_Nodes that define them, enabling cross-file reference resolution during stitching.
- **Stitcher**: The component that resolves cross-file references (imports, type usages, method calls) against the Symbol_Table and produces the directed Dependency_Edges of the cross-file dependency graph.
- **Dependency_Edge**: A directed edge of the dependency graph from a source Graph_Node to a target Graph_Node, conforming to the `DependencyEdge` interface of the JSON contract, carrying the frequency signals `importFrequency`, `methodCallFrequency`, and `sharedTypeCount`.
- **Import_Edge**: A Dependency_Edge that represents one code entity depending on another via a resolved import or cross-file type reference, at file-to-file or class-to-class granularity.
- **Import_Frequency**: A finite, non-negative numeric count recorded on a Dependency_Edge as `importFrequency`, representing the number of resolved import-based references from the source entity to the target entity.
- **Method_Call_Frequency**: A finite, non-negative numeric count recorded on a Dependency_Edge as `methodCallFrequency`, representing the number of resolved cross-entity method calls from the source to the target. (Phase-1 simplification: may start at zero or a basic count.)
- **Shared_Type_Count**: A finite, non-negative numeric count recorded on a Dependency_Edge as `sharedTypeCount`, representing the number of shared type references between the source and target. (Phase-1 simplification: may start at zero or a basic count.)
- **Dependency_Graph**: The complete in-memory directed graph of Graph_Nodes and Dependency_Edges produced by stitching, held in a `graphology` graph and serialized to `graph.json`.
- **Graph_Serializer**: The component that writes the Dependency_Graph to a single `graph.json` file in canonical order conforming to the JSON contract.
- **Graph_Output_File**: The single `graph.json` file emitted by the Graph_Serializer, the sole persisted artifact of the Parser_System.
- **JSON_Contract**: The shared `GraphNode` and `DependencyEdge` interface definitions (`packages/shared`, `steering/architecture.md`, and the core spec's Data Models section) that `graph.json` must conform to exactly so the grouping algorithm can ingest it without modification.
- **Canonical_Order**: A total ordering of nodes (by node identifier) and of edges (by the `(source, target)` identifier pair) used for every output iteration so that identical input produces byte-identical output.
- **Parse_Error**: A structured error returned by the Parser_System identifying the nature and location of a failure (missing path, non-Java input, unparseable file, or write failure) without producing any partial Graph_Output_File.

## Requirements

### Requirement 1: Accept and Validate the Project Directory Input

**User Story:** As an engine user, I want the parser to accept a path to a local Java project and validate it before doing any work, so that invalid input fails fast with a clear message instead of producing a broken graph.

#### Acceptance Criteria

1. WHEN a Project_Directory path that exists, refers to a directory, and is readable (the directory can be opened and its entries listed by the running process) is provided to the Parser_System, THE Parser_System SHALL accept the path and proceed to source file collection.
2. THE Parser_System SHALL complete all Project_Directory validation (existence, type, and readability checks) before reading, collecting, or parsing any source file, and SHALL perform no source file collection when validation fails.
3. IF no Project_Directory path is provided, or the provided path is null, an empty string, or a string containing only whitespace, THEN THE Parser_System SHALL reject the input and return a Parse_Error whose reason indicates that no Project_Directory path was provided.
4. IF the provided Project_Directory path does not exist on disk, THEN THE Parser_System SHALL reject the input and return a Parse_Error whose reason indicates a missing path and which includes the provided path.
5. IF the provided Project_Directory path exists but refers to a file rather than a directory, THEN THE Parser_System SHALL reject the input and return a Parse_Error whose reason indicates that the path is not a directory and which includes the provided path.
6. IF the provided Project_Directory path exists and refers to a directory but cannot be read by the running process due to insufficient permissions, THEN THE Parser_System SHALL reject the input and return a Parse_Error whose reason indicates a read-permission failure and which includes the provided path.
7. WHEN the Parser_System rejects a Project_Directory input for any reason, THE Parser_System SHALL return exactly one Parse_Error identifying the single failure reason and SHALL produce no graph output.

### Requirement 2: Collect Java Source Files

**User Story:** As an engine user, I want the parser to find every Java source file in my project, so that the resulting graph reflects the whole codebase and ignores non-Java files.

#### Acceptance Criteria

1. WHEN a valid Project_Directory is provided, THE Source_File_Collector SHALL recursively discover every Java_Source_File within the Project_Directory and its subdirectories at any nesting depth.
2. THE Source_File_Collector SHALL treat a file as a Java_Source_File if and only if the file is a regular file whose name ends with the `.java` extension compared case-sensitively, such that `.java` matches and `.JAVA` does not.
3. WHEN the Source_File_Collector encounters a directory, a symbolic link, or a regular file that is not a Java_Source_File, THE Source_File_Collector SHALL exclude that entry from the set of files to be parsed and SHALL continue discovery without raising an error.
4. IF the Project_Directory or any of its subdirectories cannot be read during discovery due to insufficient permissions, THEN THE Parser_System SHALL return a Parse_Error identifying the directory that could not be read and SHALL produce no graph output.
5. IF the Project_Directory is readable but contains no Java_Source_File, THEN THE Parser_System SHALL return a Parse_Error indicating that no Java source files were found in the Project_Directory.
6. THE Source_File_Collector SHALL produce the set of discovered Java_Source_Files in Canonical_Order, defined as ascending byte-wise lexicographic ordering by path relative to the Project_Directory, so that downstream extraction order is independent of filesystem enumeration order.

### Requirement 3: Extract Nodes from Per-File ASTs

**User Story:** As a framework developer, I want each Java file parsed into file, class, and function nodes, so that the dependency graph has the code entities the grouping algorithm expects.

#### Acceptance Criteria

1. WHEN a Java_Source_File is provided to the AST_Extractor, THE AST_Extractor SHALL parse the file with the Tree-Sitter Java grammar into a transient Abstract_Syntax_Tree.
2. THE AST_Extractor SHALL create exactly one Graph_Node with Node_Kind `file` for each Java_Source_File that is successfully parsed.
3. THE AST_Extractor SHALL create exactly one Graph_Node with Node_Kind `class` for each class, interface, enum, or record type declared in the Abstract_Syntax_Tree, including each nested or inner type declaration.
4. THE AST_Extractor SHALL create exactly one Graph_Node with Node_Kind `function` for each method or constructor declared in the Abstract_Syntax_Tree, creating a separate Graph_Node for each overload that shares a name but differs in its declared parameter type list.
5. THE AST_Extractor SHALL record on every Graph_Node a `directoryPath` equal to the path of the Graph_Node's defining file's directory relative to the Project_Directory, expressed with forward-slash (`/`) separators and no leading separator.
6. IF a Graph_Node's defining file resides directly in the Project_Directory root, THEN THE AST_Extractor SHALL record that Graph_Node's `directoryPath` as an empty string.
7. WHERE a Java_Source_File declares a package, THE AST_Extractor SHALL record that declared package, as its dotted package name, as the `packagePath` of every Graph_Node defined in that file.
8. IF a Java_Source_File declares no package, THEN THE AST_Extractor SHALL record an empty string as the `packagePath` of every Graph_Node defined in that file.
9. THE AST_Extractor SHALL record on every Graph_Node of Node_Kind `class` and `function` a `definedInFile` referencing the node identifier of the `file` Graph_Node in which the entity is declared.
10. THE AST_Extractor SHALL assign every Graph_Node a node identifier derived solely from the entity's stable structural attributes (its package, enclosing type chain, entity name, and, for `function` nodes, its declared parameter type list), and SHALL NOT derive node identifiers from sequential counters, timestamps, wall-clock values, random values, memory addresses, or filesystem enumeration order.
11. WHEN the same unchanged Java_Source_File is parsed on separate runs, THE AST_Extractor SHALL assign each resulting Graph_Node a node identifier identical to the one assigned on the prior run.
12. THE AST_Extractor SHALL ensure that no two distinct Graph_Nodes share the same node identifier.
13. WHEN the AST_Extractor has extracted the entities of a Java_Source_File, THE AST_Extractor SHALL discard that file's Abstract_Syntax_Tree before the Dependency_Graph is serialized, such that no Abstract_Syntax_Tree is persisted to the Graph_Output_File.

### Requirement 4: Build the Symbol Table for Cross-File Resolution

**User Story:** As a framework developer, I want a symbol table that maps Java names to the nodes that define them, so that cross-file references can be resolved during stitching.

#### Acceptance Criteria

1. WHEN node extraction across all Java_Source_Files is complete, THE Parser_System SHALL build a Symbol_Table that maps each declared class and each declared function to the single Graph_Node that defines it.
2. THE Symbol_Table SHALL key each declared class by its fully qualified name, formed by joining the declaring file's `packagePath` and the class's simple name with a single "." separator, so that classes with the same simple name in different packages are distinguished.
3. IF a declared class is defined in a file that has no `packagePath` (default package), THEN THE Parser_System SHALL key that class in the Symbol_Table by its simple name alone.
4. THE Symbol_Table SHALL key each declared function by a fully qualified name, formed by joining the fully qualified name of its enclosing class with the function's simple name using a single "." separator, so that identically named functions in different classes are distinguished.
5. WHEN two or more declarations resolve to the same fully qualified name, THE Symbol_Table SHALL retain exactly one entry, selecting the Graph_Node that sorts first under Canonical_Order, so that resolution is reproducible.
6. WHEN the Symbol_Table is built two or more times from identical extracted nodes, THE Symbol_Table SHALL produce identical name-to-node mappings, enforcing deterministic iteration order during construction so that the resulting mappings are byte-for-byte identical regardless of any non-deterministic ordering of the underlying data structures.
7. WHEN a lookup is requested for a fully qualified name that has no entry in the Symbol_Table, THE Parser_System SHALL return a not-found result without raising an error.

### Requirement 5: Stitch Per-File ASTs into Cross-File Import Edges

**User Story:** As a framework developer, I want cross-file references resolved into directed dependency edges, so that the flat per-file ASTs become a single connected dependency graph.

#### Acceptance Criteria

1. WHERE a reference in a Java_Source_File resolves through the Symbol_Table to a known target Graph_Node, THE Stitcher SHALL create exactly one Import_Edge directed from the referencing entity to the resolved target entity.
2. THE Stitcher SHALL create each Import_Edge such that both its source and its target are Graph_Nodes of Node_Kind `file` or `class`, and SHALL NOT create an Import_Edge whose source or target is a Graph_Node of Node_Kind `function`.
3. WHEN multiple resolved references connect the same source Graph_Node to the same target Graph_Node in the same direction, THE Stitcher SHALL represent them as exactly one Dependency_Edge rather than as duplicate parallel edges.
4. IF a referenced name cannot be resolved against the Symbol_Table because its declaring entity is not part of the Project_Directory, THEN THE Stitcher SHALL omit a Dependency_Edge for that reference and SHALL NOT create a Graph_Node for the unresolved external entity.
5. IF a candidate Dependency_Edge would have a source or target that is absent from the node set, THEN THE Stitcher SHALL NOT create that Dependency_Edge, such that every Dependency_Edge endpoint references an existing Graph_Node.
6. IF a resolved reference would connect a Graph_Node to itself, including references between entities declared in the same file that resolve to the same node, THEN THE Stitcher SHALL NOT create a self-referential Dependency_Edge.
7. WHEN the Stitcher processes identical extracted nodes and a Symbol_Table built from identical input, THE Stitcher SHALL produce an identical set of Dependency_Edges independent of file or reference processing order.

### Requirement 6: Compute Edge Frequency Signals

**User Story:** As a framework developer, I want every dependency edge to carry the three contract frequency signals, so that the downstream weighting step receives the exact edge shape it expects.

#### Acceptance Criteria

1. THE Stitcher SHALL record on every Dependency_Edge exactly the three frequency signals named `importFrequency`, `methodCallFrequency`, and `sharedTypeCount`, and SHALL NOT record any additional or fewer frequency signals.
2. THE Stitcher SHALL compute the `importFrequency` of a Dependency_Edge as the integer count of resolved import-based references from the edge's source entity to the edge's target entity, counting each resolved reference exactly once.
3. THE Stitcher SHALL record a `methodCallFrequency` for every Dependency_Edge as the integer count of distinct resolved cross-entity method calls from source to target, where the Phase-1 simplification permits this count to be 0 when cross-entity method-call resolution is not yet performed.
4. THE Stitcher SHALL record a `sharedTypeCount` for every Dependency_Edge as the integer count of distinct shared type references between source and target, where the Phase-1 simplification permits this count to be 0 when shared-type resolution is not yet performed.
5. THE Stitcher SHALL ensure that every frequency signal on every Dependency_Edge is a finite, non-negative integer, never negative, never fractional, and never a non-finite value such as NaN or Infinity.
6. WHEN a Dependency_Edge has no resolved reference contributing to a given frequency signal, THE Stitcher SHALL set that signal to exactly 0 rather than leaving it absent or undefined.
7. WHEN the Stitcher computes the frequency signals for a Dependency_Edge two or more times on identical input, THE Stitcher SHALL produce identical `importFrequency`, `methodCallFrequency`, and `sharedTypeCount` values.

### Requirement 7: Conform to the JSON Contract

**User Story:** As a downstream consumer, I want the parser output to match the shared JSON contract exactly, so that the grouping algorithm can ingest `graph.json` without any modification.

#### Acceptance Criteria

1. WHEN the Graph_Serializer emits a Graph_Node, THE Graph_Serializer SHALL emit it conforming to the `GraphNode` interface of the JSON_Contract, with a non-empty string `id` that is unique across the emitted node set, a `kind` equal to exactly one of `file`, `class`, or `function`, and a string `directoryPath`.
2. WHERE a Graph_Node has `kind` of `class` or `function`, THE Graph_Serializer SHALL emit a non-empty string `definedInFile` whose value equals the `id` of an emitted `file` node; WHERE a Graph_Node has `kind` of `file`, THE Graph_Serializer SHALL omit the `definedInFile` field.
3. WHERE a Graph_Node maps to a declared Java package, THE Graph_Serializer SHALL emit a non-empty string `packagePath`; WHERE a Graph_Node has no declared Java package, THE Graph_Serializer SHALL omit the `packagePath` field.
4. WHEN the Graph_Serializer emits a Dependency_Edge, THE Graph_Serializer SHALL emit it conforming to the `DependencyEdge` interface of the JSON_Contract, with a `source` and a `target`, and with `importFrequency`, `methodCallFrequency`, and `sharedTypeCount` each emitted as a non-negative integer in the range 0 to 2,147,483,647 inclusive.
5. THE Graph_Serializer SHALL emit the `source` and `target` of every Dependency_Edge as values that each equal the `id` of a node present in the emitted node set.
6. IF a Dependency_Edge references a `source` or `target` that is not present in the emitted node set, THEN THE Graph_Serializer SHALL omit that edge from `graph.json` and record a diagnostic identifying the dropped edge, such that no dangling edge reference is emitted.
7. THE Graph_Serializer SHALL NOT emit a `strength` field on any Dependency_Edge, such that the optional `strength` field is left absent for the downstream Dependency_Weight_Calculator to populate.
8. THE Graph_Serializer SHALL emit `graph.json` such that an ingestor conforming to Requirement 1 of the core `hierarchical-repository-grouping` spec loads the complete node set and edge set with no additions, no removals, and no field renaming, and reports zero schema validation errors.

### Requirement 8: Serialize the Graph to a Single Output File

**User Story:** As an engine user, I want the dependency graph written to a single graph.json file, so that the next pipeline stage has one well-defined artifact to read.

#### Acceptance Criteria

1. WHEN the Dependency_Graph is complete, THE Graph_Serializer SHALL write the entire graph to exactly one Graph_Output_File named `graph.json`, and SHALL NOT distribute the graph across more than one file.
2. WHEN the Graph_Serializer writes the Graph_Output_File, THE Graph_Serializer SHALL write every Graph_Node in the Dependency_Graph, such that the count of nodes written equals the count of Graph_Nodes in the Dependency_Graph, including the boundary case of zero Graph_Nodes.
3. WHEN the Graph_Serializer writes the Graph_Output_File, THE Graph_Serializer SHALL write every Dependency_Edge in the Dependency_Graph, such that the count of edges written equals the count of Dependency_Edges in the Dependency_Graph, including the boundary case of zero Dependency_Edges.
4. IF the output location is inaccessible or the running process lacks permission to write it, THEN THE Graph_Serializer SHALL return a Parse_Error identifying the output location that could not be written and SHALL NOT produce a partial or empty `graph.json`.
5. IF a write failure occurs after writing of the Graph_Output_File has begun, THEN THE Graph_Serializer SHALL return a Parse_Error and SHALL NOT leave a partial Graph_Output_File at the output location.
6. WHEN the Graph_Serializer completes without returning a Parse_Error, THE Graph_Serializer SHALL have written `graph.json` such that it parses successfully as a single JSON value by a standard JSON reader without error.

### Requirement 9: Deterministic Output

**User Story:** As a researcher evaluating the engine, I want identical input to always produce an identical graph.json, so that parser results are reproducible and the downstream pipeline is deterministic.

#### Acceptance Criteria

1. WHEN the Parser_System processes an identical Project_Directory twice — identical in the byte content of every Java_Source_File, independent of file modification times and filesystem enumeration order — THE Parser_System SHALL produce two Graph_Output_Files with identical SHA-256 digests.
2. THE Graph_Serializer SHALL emit Graph_Nodes in Canonical_Order by ascending node identifier, compared byte-wise lexicographically over the UTF-8 identifier string.
3. THE Graph_Serializer SHALL emit Dependency_Edges in Canonical_Order by ascending `(source, target)` identifier pair, compared byte-wise lexicographically on `source` first and `target` as tie-break, where each `(source, target)` pair is unique so the ordering is total.
4. THE Parser_System SHALL NOT include any timestamp, wall-clock value, run counter, absolute host path, or random value in the Graph_Output_File.
5. WHEN the filesystem enumeration order of the Java_Source_Files differs between two runs over the same Project_Directory contents, THE Parser_System SHALL produce two Graph_Output_Files with identical SHA-256 digests.
6. THE Graph_Serializer SHALL write `graph.json` using UTF-8 encoding without a byte-order mark, `\n` line endings, and a fixed canonical ordering of object keys, so that byte-level output is fully determined by the graph content.
7. WHEN a parse run completes successfully and the Project_Directory contains the minimum valid set of Java_Source_Files that yields zero nodes or zero edges, THE Graph_Serializer SHALL emit a well-formed `graph.json` with the corresponding empty node array or empty edge array, and SHALL produce identical SHA-256 digests across repeated runs.

### Requirement 10: Error Handling Without Partial Output

**User Story:** As an engine user, I want parsing failures reported clearly without leaving junk behind, so that I can trust that a produced graph.json is complete and valid.

#### Acceptance Criteria

1. IF a Java_Source_File cannot be parsed because its content is not syntactically valid Java that the Tree-Sitter Java grammar can process into usable declarations, THEN THE Parser_System SHALL record a Parse_Error identifying, by its file path, the file that could not be parsed, and MAY continue parsing the remaining Java_Source_Files.
2. IF a Java_Source_File cannot be read from disk because it is inaccessible or the read operation fails, THEN THE Parser_System SHALL record a Parse_Error identifying the affected file by its file path, and MAY continue parsing the remaining Java_Source_Files.
3. THE Parser_System SHALL defer all writing of the Graph_Output_File until parsing of every Java_Source_File has completed, such that no `graph.json` is created or written before parsing completes.
4. IF one or more Parse_Errors were recorded during a parse run, THEN THE Parser_System SHALL return those Parse_Errors and SHALL NOT create, write, or leave behind any partial, empty, or incomplete Graph_Output_File at the output location.
5. THE Parser_System SHALL report every Parse_Error with a message identifying the nature of the failure and, where the failure concerns a specific file or path, the file or path involved.
6. IF a parse run completes with one or more recorded Parse_Errors and a prior valid `graph.json` exists at the output location, THEN THE Parser_System SHALL leave the prior Graph_Output_File byte-for-byte unmodified rather than overwriting, truncating, or deleting it.

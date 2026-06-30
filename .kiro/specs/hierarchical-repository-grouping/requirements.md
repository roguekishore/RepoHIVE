# Requirements Document

## Introduction

This feature defines the **grouping algorithm** at the heart of the RepoHIVE Hierarchical Codebase Indexing Framework. Its purpose is to automatically transform a large, flat dependency graph (for example, 4,000 files and 50,000 dependencies extracted by the Tree-Sitter parsing layer) into a navigable, multi-level hierarchy of the form Repository → Level 1 Groups → Level 2 Groups → Files → Functions.

The central research contribution is **adaptive hierarchy construction driven by repository structural quality**: we assess repository structural quality per region and adapt hierarchy construction accordingly — preserving well-structured regions and reconstructing poorly-structured ones — rather than imposing a single global grouping method. Structural quality is measured primarily with established, defensible package-quality metrics (cohesion and coupling) computed over the dependency graph and its dependency strengths, with Newman-style modularity available as an optional secondary signal; this yields a graded structural-quality score per region rather than a single brittle threshold on a proxy such as edge density. Where a decision boundary is required, it is treated as an empirically calibrated, tunable parameter that is recorded in metadata so its sensitivity can be analyzed and every preserve-versus-reconstruct decision is reproducible and auditable.

The output of the algorithm is a set of JSON index files (repository.json, hierarchy.json, nodes.json, edges.json, metadata.json) that serve three consumers: scalable human visualization (React + React Flow), a structured traversal model for AI agents, and a repository knowledge layer for retrieval.

This spec scopes the grouping algorithm only. The core scope is structural-quality assessment of regions and adaptive (preserve vs reconstruct) hierarchy construction. The supporting scope comprises graph ingestion, dependency-strength weighting, multi-level hierarchy assembly, determinism, dependency preservation, blast radius analysis, and the JSON index output format. It explicitly excludes intent detection, automatic flow naming, repository semantic understanding, and LLM-generated architecture decisions, which are optional product features outside the core research.

Reflecting realistic incremental scheduling, the work is phased. Phase 1 delivers the core contribution: structural-quality assessment plus adaptive preserve-versus-reconstruct hierarchy construction (Requirements 3, 4, and 5). The supporting capabilities — JSON index serialization and round-trip parsing (Requirement 9), blast radius analysis (Requirement 10), cross-group edge aggregation (Requirement 8), and the full determinism guarantees (Requirement 7) — are supporting scope to be implemented after the core is validated. All requirements in this document remain in scope; the phasing describes implementation sequencing only and does not remove any requirement.

The Region concept is intentionally general in these requirements (package, module, or directory subtree) so that the research contribution applies across ecosystems. The Phase 1 implementation, however, narrows Region identification to a single concrete strategy — Java packages, where each declared package is a Region — to keep the first build tractable. Generalization to other ecosystems (for example, Node, Python, and monorepos) and to module and directory subtrees is later implementation scope and does not change the requirements.

## Glossary

- **Grouping_System**: The overall subsystem that transforms a flat dependency graph into a multi-level hierarchy and emits the JSON index files.
- **Graph_Ingestor**: The component that reads the Tree-Sitter-derived dependency graph (files, classes, methods, imports, function calls, dependencies) into the in-memory model used by the Grouping_System.
- **Dependency_Graph**: The directed graph of code entities (files, functions, classes) and their dependency edges produced by the Tree-Sitter parsing layer and consumed by the Graph_Ingestor.
- **Dependency_Weight_Calculator**: The component that computes a numeric dependency strength for each edge from import frequency, method call frequency, and shared type usage.
- **Dependency_Strength**: A numeric weight assigned to an edge representing the coupling between two nodes, derived from import frequency, method call frequency, and shared type usage.
- **Region**: A subtree of the repository structure (a package, module, or directory subtree) that is treated as a candidate unit for structural-quality assessment and for the preserve-versus-reconstruct decision.
- **Primary_Region**: The single Region that owns a given File node for the purpose of the preserve-versus-reconstruct decision, selected by a deterministic precedence rule: the most-specific declared package or module boundary containing the File node; if no package or module boundary is declared for the File node, the most-specific directory subtree containing the File node. Every File node has exactly one Primary_Region, so Primary_Region ownership is total and non-overlapping across File nodes.
- **Structural_Quality_Assessor**: The component that computes a Structural_Quality_Score for each Region using Cohesion and Coupling measures (and optionally the Modularity measure) derived from the Dependency_Graph and Dependency_Strength.
- **Cohesion**: A measure of intra-Region coupling relative to Region size (LCOM-style), where a higher value indicates that the members of a Region are more strongly related to one another.
- **Coupling**: A measure of inter-Region dependency, derived from the Dependency_Strength of edges that cross a Region boundary relative to the total Dependency_Strength incident to the Region, where a lower value indicates better isolation.
- **Modularity**: An OPTIONAL, secondary measure: the Newman-style modularity (Q) of the partition formed by the Region boundaries, measuring the extent to which dependency edges are concentrated within Regions relative to a randomized baseline. Modularity is not used as the primary discriminator for the preserve-versus-reconstruct decision because it is circular in this context — Newman modularity is the objective that the Reconstruct_Action's community detection optimizes, so using it to decide whether to run community detection would beg the question. Cohesion and Coupling are the primary, independent package-quality measures.
- **Structural_Quality_Score**: A continuous numeric score on a graded scale (0.0 to 1.0) representing how well-structured a Region is, computed as a weighted combination of the normalized Cohesion and Coupling measures (and optionally the normalized Modularity measure), where higher values indicate better structure. The per-metric weights are externally configurable parameters that are recorded in metadata; the exact combination function is a design-phase decision and a sensitivity-analysis target.
- **Structural_Quality_Boundary**: The empirically calibrated, configurable decision-boundary parameter on the Structural_Quality_Score used to choose between a Preserve_Action and a Reconstruct_Action; it is recorded in metadata and is subject to sensitivity analysis.
- **Decision_Confidence**: The absolute difference |Structural_Quality_Score − Structural_Quality_Boundary| for a Primary_Region, indicating how decisively the preserve-versus-reconstruct decision was made (a larger value means more confident).
- **Adaptive_Hierarchy_Constructor**: The component that, using each Region's Structural_Quality_Score, decides between a Preserve_Action and a Reconstruct_Action for that Region and executes the chosen action to produce per-Region group results.
- **Preserve_Action**: The construction action applied to a well-structured Region that keeps the Region's existing directory/package boundaries as its Group_Node boundaries. The Preserve_Action subsumes the former directory-structure and package/module grouping methods as the "preserve" path.
- **Reconstruct_Action**: The construction action applied to a poorly-structured Region that rebuilds the Region's Group_Nodes via dependency-based community detection over the Region's nodes and Dependency_Strength-weighted edges. The Reconstruct_Action subsumes the former community-detection grouping method as the "reconstruct" path and is a binary action (applied or not), not graded.
- **Hierarchy_Builder**: The component that assembles the per-Region group results into the multi-level Hierarchy.
- **Hierarchy**: The multi-level tree of nodes with levels Repository (level 0), Level 1 Groups, Level 2 Groups, Files, and Functions.
- **Group_Node**: A non-leaf hierarchy node representing a collection of child nodes at the next level down.
- **Leaf_Node**: A File node or Function node that has no group children in the Hierarchy.
- **Index_Serializer**: The component that writes the Hierarchy and graph data to the JSON index files.
- **Index_Parser**: The component that reads the JSON index files back into the in-memory model.
- **Index_File_Set**: The set of JSON files repository.json, hierarchy.json, nodes.json, edges.json, and metadata.json that together represent the persisted output.
- **Blast_Radius_Analyzer**: The component that, given a modified node, determines the set of impacted files, functions, and hierarchy regions.
- **Blast_Radius**: The set of nodes and hierarchy regions reachable through dependency edges from a given modified node.
- **Cross_Group_Edge**: A dependency edge whose endpoints belong to different Group_Nodes, aggregated and represented at the appropriate hierarchy level.

## Requirements

### Requirement 1: Ingest the Dependency Graph

**User Story:** As a framework developer, I want the grouping algorithm to ingest the Tree-Sitter dependency graph, so that grouping operates on a complete and validated representation of the repository.

#### Acceptance Criteria

1. WHEN a Dependency_Graph is provided to the Graph_Ingestor, THE Graph_Ingestor SHALL load every file node, function node, class node, and dependency edge present in the input into the in-memory model such that the count of each node type and the count of edges in the in-memory model equals the corresponding count in the input.
2. IF the provided Dependency_Graph contains an edge that references a node identifier not present in the node set, THEN THE Graph_Ingestor SHALL reject the input, perform no partial load, and return an error message identifying the missing node identifier.
3. IF the provided Dependency_Graph contains zero nodes, THEN THE Graph_Ingestor SHALL reject the input and return an error message indicating that no nodes were found.
4. WHEN ingestion completes successfully, THE Graph_Ingestor SHALL preserve every input node and every input edge with no additions and no removals, such that the set of node identifiers and the set of edges in the in-memory model are identical to those in the input.
5. IF the provided Dependency_Graph contains two or more nodes sharing the same node identifier, THEN THE Graph_Ingestor SHALL reject the input and return an error message identifying the duplicated node identifier.
6. IF no Dependency_Graph is provided to the Graph_Ingestor, or the provided Dependency_Graph is null, THEN THE Graph_Ingestor SHALL reject the input and return an error message indicating that no Dependency_Graph was provided.

### Requirement 2: Compute Dependency Strength

**User Story:** As a framework developer, I want each dependency edge to carry a computed strength, so that structural-quality assessment, grouping, and blast radius analysis can reason about coupling.

#### Acceptance Criteria

1. THE Dependency_Weight_Calculator SHALL assign exactly one Dependency_Strength value to every edge in the Dependency_Graph.
2. THE Dependency_Weight_Calculator SHALL compute each Dependency_Strength as a function of three non-negative numeric inputs measured between the two endpoint nodes of the edge: import frequency, method call frequency, and shared type usage count.
3. THE Dependency_Weight_Calculator SHALL produce a Dependency_Strength that is a finite numeric value greater than or equal to zero for every edge.
4. THE Dependency_Weight_Calculator MAY use any reasonable weighting function and SHALL NOT be required to guarantee strict monotonicity; WHEN the import frequency, method call frequency, and shared type usage count for one node pair are each greater than or equal to the corresponding input for a second node pair, THE Dependency_Weight_Calculator SHALL generally assign the first pair a Dependency_Strength greater than or equal to that of the second pair, but MAY deviate from this ordering where the chosen weighting function yields better overall accuracy.
5. WHEN all three inputs (import frequency, method call frequency, and shared type usage count) for an edge are zero, THE Dependency_Weight_Calculator SHALL assign that edge a Dependency_Strength of zero.
6. WHEN the Dependency_Weight_Calculator is run two or more times on identical input, THE Dependency_Weight_Calculator SHALL produce identical Dependency_Strength values for every edge.

### Requirement 3: Assess Structural Quality of Regions

**User Story:** As a framework developer, I want each region of the repository assessed for structural quality using defensible structural metrics, so that hierarchy construction can adapt to how well-structured each region already is rather than relying on a brittle global threshold.

#### Acceptance Criteria

1. WHEN a Dependency_Graph is provided, THE Structural_Quality_Assessor SHALL identify candidate Regions from the package, module, and directory subtrees of the repository structure, and SHALL assign each File node to exactly one Primary_Region using the deterministic precedence rule, such that structural-quality assessment that drives the preserve-versus-reconstruct decision is performed per Primary_Region.
2. THE Structural_Quality_Assessor SHALL assign every File node to exactly one Primary_Region, such that Primary_Region ownership is total and non-overlapping across File nodes.
3. THE Structural_Quality_Assessor SHALL compute for each Region a Cohesion measure derived from the Dependency_Strength of edges whose source and target nodes both lie within the Region, normalized by the number of nodes in the Region.
4. THE Structural_Quality_Assessor SHALL compute for each Region a Coupling measure derived from the Dependency_Strength of edges that cross the Region boundary, normalized by the total Dependency_Strength incident to the nodes of the Region.
5. THE Structural_Quality_Assessor MAY compute a Newman-style Modularity value for the partition formed by the Region boundaries over the Dependency_Strength-weighted Dependency_Graph as an optional secondary measure.
6. THE Structural_Quality_Assessor SHALL compute each Region's Structural_Quality_Score as a weighted combination of the normalized Cohesion and Coupling measures (and optionally the normalized Modularity measure where it is computed), using externally configurable per-metric weights, producing a value in the range 0.0 to 1.0 inclusive where a higher value indicates better structure.
7. THE Structural_Quality_Assessor SHALL record the per-metric weights used to compute the Structural_Quality_Score in the metadata output, so that the combination is auditable and tunable.
8. THE Structural_Quality_Assessor SHALL produce a finite Structural_Quality_Score for every identified Region.
9. IF a Region contains fewer than two nodes or has zero internal edges, THEN THE Structural_Quality_Assessor SHALL assign that Region a Structural_Quality_Score using the documented degenerate-case rule and SHALL NOT fail or return an undefined score.
10. WHEN the Structural_Quality_Assessor is run two or more times on identical input, THE Structural_Quality_Assessor SHALL produce identical Cohesion, Coupling, and Structural_Quality_Score values for every Region, and identical Modularity values for every Region WHERE Modularity is computed.

### Requirement 4: Adaptively Construct the Hierarchy by Preserving or Reconstructing Regions

**User Story:** As a framework developer, I want the system to preserve the structure of well-structured regions and reconstruct poorly-structured regions, so that the hierarchy reflects the best available structure rather than a single global grouping method.

#### Acceptance Criteria

1. WHEN the Structural_Quality_Scores for all Primary_Regions are available, THE Adaptive_Hierarchy_Constructor SHALL decide for each Primary_Region exactly one of a Preserve_Action or a Reconstruct_Action by comparing the Primary_Region's Structural_Quality_Score against the Structural_Quality_Boundary, so that each File node's action is unambiguous.
2. WHERE a Primary_Region's Structural_Quality_Score is greater than or equal to the Structural_Quality_Boundary, THE Adaptive_Hierarchy_Constructor SHALL apply a Preserve_Action that retains the Primary_Region's existing directory and package boundaries as its Group_Node boundaries.
3. WHERE a Primary_Region's Structural_Quality_Score is less than the Structural_Quality_Boundary, THE Adaptive_Hierarchy_Constructor SHALL apply a Reconstruct_Action that rebuilds the Primary_Region's Group_Nodes via dependency-based community detection over the Primary_Region's nodes and Dependency_Strength-weighted edges.
4. THE Structural_Quality_Boundary SHALL be an externally configurable parameter that can be varied across runs without code changes, so that a sensitivity analysis of the preserve-versus-reconstruct decisions can be performed.
5. THE Adaptive_Hierarchy_Constructor SHALL assign every File node from the Dependency_Graph to exactly one Group_Node result via that File node's Primary_Region, such that no File node is dropped and no File node appears in more than one Primary_Region's result.
6. WHERE the user supplies an explicit Preserve_Action or Reconstruct_Action for a specific Primary_Region, THE Adaptive_Hierarchy_Constructor SHALL apply the user-supplied action for that Primary_Region in place of the automatically computed decision.
7. WHEN the Adaptive_Hierarchy_Constructor is run two or more times on identical input with an identical Structural_Quality_Boundary, THE Adaptive_Hierarchy_Constructor SHALL produce identical preserve-versus-reconstruct decisions and identical per-Primary_Region Group_Node results.

### Requirement 5: Record Structural Quality and Construction Metadata

**User Story:** As a researcher evaluating the algorithm, I want the per-region structural scores, the preserve-versus-reconstruct decisions, and the calibrated boundary parameter recorded, so that every decision is reproducible and auditable and the boundary's sensitivity can be evaluated.

#### Acceptance Criteria

1. THE Adaptive_Hierarchy_Constructor SHALL record in the metadata output, for every Primary_Region, the Primary_Region identifier, the Primary_Region's Cohesion and Coupling values, the combined Structural_Quality_Score value, and the Modularity value WHERE Modularity is computed.
2. THE Adaptive_Hierarchy_Constructor SHALL record in the metadata output the per-metric weights used to combine the measures into the Structural_Quality_Score.
3. THE Adaptive_Hierarchy_Constructor SHALL record in the metadata output, for every Primary_Region, whether a Preserve_Action or a Reconstruct_Action was applied.
4. THE Adaptive_Hierarchy_Constructor SHALL record in the metadata output, for every Primary_Region, a decision-confidence value computed as the absolute difference between the Primary_Region's Structural_Quality_Score and the Structural_Quality_Boundary.
5. THE Adaptive_Hierarchy_Constructor SHALL record in the metadata output the Structural_Quality_Boundary value used for the run.
6. WHERE a per-Primary_Region action was supplied by the user in place of the automatically computed decision, THE Adaptive_Hierarchy_Constructor SHALL record in the metadata output both the user-supplied action and the automatically computed decision it replaced.
7. WHEN the recorded Structural_Quality_Boundary and the recorded per-Primary_Region Structural_Quality_Scores from a prior run are re-applied to the same Dependency_Graph, THE Grouping_System SHALL reproduce identical preserve-versus-reconstruct decisions for every Primary_Region.

### Requirement 6: Build a Multi-Level Hierarchy

**User Story:** As a framework developer, I want the per-region results assembled into a multi-level hierarchy, so that large repositories become navigable from repository root down to individual functions.

#### Acceptance Criteria

1. WHEN the Adaptive_Hierarchy_Constructor has produced the per-Region Group_Node results, THE Hierarchy_Builder SHALL assemble them into a Hierarchy with a single Repository node at level 0.
2. THE Hierarchy_Builder SHALL assign every File node from the Dependency_Graph to exactly one path of the shape Repository node → Level 1 Group_Node → Level 2 Group_Node → File node.
3. THE Hierarchy_Builder SHALL assign every Function node from the Dependency_Graph as a child of the File node in which that Function is defined.
4. THE Hierarchy_Builder SHALL produce a Hierarchy in which every Group_Node contains at least one child node.
5. THE Hierarchy_Builder SHALL produce a Hierarchy that contains no cycles in the containment relationship.
6. THE Hierarchy_Builder SHALL use a configured maximum group size that is an integer between 2 and 50 inclusive, with a default of 20.
7. WHEN a Group_Node at Level 1 or Level 2 would contain more child nodes than the configured maximum group size, THE Hierarchy_Builder SHALL partition that Group_Node into the smallest number of additional Group_Nodes such that each resulting Group_Node contains at least one child and no more than the configured maximum group size.
8. THE Hierarchy_Builder SHALL apply partitioning only to Group_Nodes whose child count is greater than or equal to the configured minimum partition threshold, and the configured minimum partition threshold SHALL be an integer between 2 and the configured maximum group size inclusive.

### Requirement 7: Deterministic and Consistent Grouping

**User Story:** As a framework developer, I want grouping to be deterministic, so that the same repository always yields the same hierarchy and results are reproducible for evaluation.

#### Acceptance Criteria

1. WHEN the Grouping_System processes identical input twice with identical configuration, THE Grouping_System SHALL produce an identical Hierarchy including identical node identifiers, identical parent-child assignments, and identical sibling ordering.
2. WHEN the order of nodes or edges in the input Dependency_Graph is changed without changing their content, THE Grouping_System SHALL produce a Hierarchy with identical node identifiers, identical group memberships, and identical sibling ordering compared to the Hierarchy produced from the unchanged-order input.
3. THE Hierarchy_Builder SHALL assign each Group_Node a stable identifier derived solely from the contents of that Group_Node, and SHALL NOT derive Group_Node identifiers from sequential counters, timestamps, wall-clock values, random values, memory addresses, or input ordering position.
4. THE Hierarchy_Builder SHALL ensure that every Group_Node in the Hierarchy has a unique identifier, such that no two distinct Group_Nodes share the same identifier.
5. THE Hierarchy_Builder SHALL order the children of every Group_Node by ascending child node identifier.

### Requirement 8: Preserve Dependency Relationships

**User Story:** As a consumer of the hierarchy, I want all original dependencies preserved, so that navigation and analysis reflect the true structure of the code.

#### Acceptance Criteria

1. THE Hierarchy_Builder SHALL retain in the output every dependency edge from the input Dependency_Graph between its original Leaf_Node endpoints, preserving the edge direction and the Dependency_Strength of each retained edge.
2. WHEN a dependency edge connects two Leaf_Nodes that belong to different Group_Nodes, THE Hierarchy_Builder SHALL represent that relationship as a Cross_Group_Edge, preserving the original edge direction, at each hierarchy level where the two endpoints have differing ancestor Group_Nodes, and SHALL create the Cross_Group_Edge between the two distinct immediate parent Group_Nodes at the lowest such level.
3. IF a dependency edge connects two Leaf_Nodes that share the same immediate parent Group_Node, THEN THE Hierarchy_Builder SHALL NOT create a Cross_Group_Edge for that dependency edge at that parent level.
4. THE Hierarchy_Builder SHALL compute each Cross_Group_Edge weight as the sum of the Dependency_Strength values of the underlying leaf-level edges that it aggregates, where an aggregated set consists of all leaf-level edges sharing the same source Group_Node and the same target Group_Node in the same direction.
5. THE Hierarchy_Builder SHALL ensure that the set of leaf-to-leaf reachability relationships in the output, following dependency edge directions, equals the set of leaf-to-leaf reachability relationships in the input Dependency_Graph.

### Requirement 9: Emit JSON Index Files

**User Story:** As a downstream consumer, I want the hierarchy written to standard JSON index files, so that the visualization, AI agents, and retrieval layer can load it.

#### Acceptance Criteria

1. WHEN the Hierarchy is complete, THE Index_Serializer SHALL write the Index_File_Set consisting of exactly five files: repository.json, hierarchy.json, nodes.json, edges.json, and metadata.json.
2. THE Index_Serializer SHALL write every Group_Node and Leaf_Node from the Hierarchy into nodes.json, such that the number of nodes written equals the total number of Group_Nodes and Leaf_Nodes in the Hierarchy.
3. THE Index_Serializer SHALL write every leaf-level edge and every Cross_Group_Edge into edges.json, such that the number of edges written equals the total number of leaf-level edges and Cross_Group_Edges in the Hierarchy.
4. THE Index_Serializer SHALL write into metadata.json the Structural_Quality_Boundary, the per-Region structural-quality metadata described in Requirement 5, the node count, the edge count, and the hierarchy depth, where hierarchy depth is the number of levels from the Repository node to the deepest Leaf_Node.
5. WHEN the Index_Parser reads an Index_File_Set produced by the Index_Serializer, THE Index_Parser SHALL reconstruct a Hierarchy having the same node set, the same edge set, the same recorded per-Region construction decisions, and the same hierarchy depth as the Hierarchy that was written.
6. IF the Index_Parser reads an Index_File_Set that is missing one or more required member files, THEN THE Index_Parser SHALL return an error message naming each missing file and SHALL NOT return a partial Hierarchy.
7. IF the Index_Parser reads an Index_File_Set in which a member file contains malformed JSON or is missing a required field, THEN THE Index_Parser SHALL return an error message identifying the affected file and SHALL NOT return a partial Hierarchy.
8. IF the Index_Serializer cannot write a member file of the Index_File_Set, THEN THE Index_Serializer SHALL return an error message identifying the file that could not be written.

### Requirement 10: Blast Radius Analysis

**User Story:** As a developer using the hierarchy, I want to query the blast radius of a modified node, so that I can see which files, functions, and hierarchy regions a change would impact.

#### Acceptance Criteria

1. WHEN a node identifier is provided to the Blast_Radius_Analyzer, THE Blast_Radius_Analyzer SHALL return the set of nodes whose dependency path reaches the provided node, by traversing dependency edges in the dependent-to-dependency direction.
2. THE Blast_Radius_Analyzer SHALL include in the Blast_Radius the Group_Nodes that contain any impacted Leaf_Node.
3. IF the provided node identifier does not exist in the Hierarchy, THEN THE Blast_Radius_Analyzer SHALL return an error message stating that the node was not found, SHALL NOT return a Blast_Radius, and SHALL leave the Hierarchy unchanged.
4. IF the provided node identifier is empty or null, THEN THE Blast_Radius_Analyzer SHALL return an error message indicating that no node identifier was provided.
5. WHEN a node has no incoming dependency edges, meaning no other node depends on it, THE Blast_Radius_Analyzer SHALL return a Blast_Radius containing only the provided node.
6. THE Blast_Radius_Analyzer SHALL include each node in the Blast_Radius at most once, even when multiple dependency paths reach the provided node.
7. WHEN traversing a Hierarchy whose dependency edges contain cycles, THE Blast_Radius_Analyzer SHALL visit each node at most once so that traversal terminates.
8. WHEN the Blast_Radius_Analyzer is queried two or more times for the same node on an unchanged Hierarchy, THE Blast_Radius_Analyzer SHALL return an identical set of node identifiers.

### Requirement 11: Scalability and Navigability Properties

**User Story:** As a user visualizing large repositories, I want the hierarchy to bound how much is shown at once, so that rendering and navigation stay responsive.

#### Acceptance Criteria

1. THE Hierarchy_Builder SHALL produce a Hierarchy in which the number of direct children of the Repository node and of every Group_Node does not exceed the configured maximum group size.
2. THE Hierarchy_Builder SHALL introduce sufficient intermediate Group_Node levels that the configured maximum group size constraint is satisfied at every node, so that hierarchy depth is derived from the maximum group size and the File node count rather than fixed at a predetermined number of levels.
3. THE Grouping_System SHALL record, in metadata.json, for each hierarchy level the count of Group_Nodes and Leaf_Nodes present at that level and the count of leaf-level edges and Cross_Group_Edges present at that level, so that the scalability of the hierarchical output can be compared against the flat graph.
4. THE Grouping_System SHALL record, in metadata.json, the total visible node count per level, the total Cross_Group_Edge count across the Hierarchy, and the average branching factor of the Group_Nodes, so that the scalability improvement of the hierarchical output over the flat graph can be quantified.
5. WHEN locating any specific File node by traversing from the Repository node along its single path of ancestor Group_Nodes, THE Hierarchy SHALL require no more than one expansion operation per Group_Node level on that path, and SHALL require no more expansion operations than the number of Group_Node levels between the Repository node and that File node.

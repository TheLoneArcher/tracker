/* Syllabus data: [id, name, short, pages, questions, [[topic, questions], ...]] */
const RAW = [
  ['c', 'Programming in C', 'C', 155, 132, [
    ['Programming: Output', 1], ['Aliasing', 1], ['Array', 13], ['Functions', 2], ['Goto', 2],
    ['Identify Function', 6], ['Loop Invariants', 8], ['Output', 8], ['Parameter Passing', 12],
    ['Pointers', 15], ['Programming Constructs', 1], ['Programming in C', 29], ['Programming Paradigms', 2],
    ['Recursion', 19], ['Runtime Environment', 1], ['Strings', 2], ['Structure', 5], ['Switch Case', 2],
    ['Type Checking', 1], ['Union', 1], ['Variable Binding', 1]
  ]],
  ['ds', 'Data Structures', 'DS', 186, 238, [
    ['AVL Trees', 6], ['Arrays & Basic Algorithms', 15], ['Heaps & Priority Queues', 29],
    ['Binary Search Trees', 38], ['Binary Trees: Traversals & Counting', 51], ['Graph Basics', 3],
    ['Hashing', 16], ['Stacks & Expression Evaluation', 4], ['Linked Lists', 24],
    ['Queues & Priority Queues', 17], ['Stack Problems', 19], ['Other Trees, Meld, 2-3 Trees', 16]
  ]],
  ['algo', 'Algorithms', 'Algo', 790, 351, [
    ['Asymptotics and loop analysis', 39], ['Recurrences', 33], ['Reading and tracing programs', 47],
    ['Divide and conquer, paradigms', 10], ['Sorting', 62], ['Searching', 12], ['Trees', 5],
    ['Graph traversal and structure', 46], ['Shortest paths', 16], ['Minimum spanning trees', 40],
    ['Greedy algorithms', 12], ['Dynamic programming', 15], ['Hashing', 12], ['Miscellaneous', 2]
  ]],
  ['toc', 'Theory of Computation', 'TOC', 487, 293, [
    ['Finite Automata: DFA and NFA', 42], ['Regular Expressions', 29], ['Regular Grammars', 4],
    ['Minimal DFA and NFA to DFA Conversion', 27], ['Non-determinism and the Power of Machines', 7],
    ['Regular Languages: Properties and the Pumping Lemma', 38], ['Context-Free Grammars', 37],
    ['Pushdown Automata', 16], ['Identifying the Class of a Language', 32], ['Closure Properties', 10],
    ['Countable and Uncountable Sets', 3], ['Turing Machines, Recursive and RE Languages', 18],
    ['Decidability and Undecidability', 30]
  ]],
  ['cd', 'Compiler Design', 'CD', 402, 242, [
    ['Phases of a Compiler', 14], ['Lexical Analysis', 9], ['Context-Free Grammars and Ambiguity', 29],
    ['Expression Grammars: Precedence and Associativity', 11], ['Top-Down Parsing and LL(1)', 28],
    ['Bottom-Up Parsing: LR(0), SLR, LALR, CLR', 34], ['Syntax-Directed Translation', 24],
    ['Intermediate Code', 15], ['Basic Blocks, Control-Flow Graphs and Liveness', 10],
    ['Code Optimization', 7], ['Code Generation and Registers', 9], ['Run-Time Environments', 28],
    ['Assemblers, Macros, Linkers and Loaders', 24]
  ]],
  ['dl', 'Digital Logic', 'DL', 635, 313, [
    ['Number Systems and Codes', 24], ['Signed Integers', 25], ["2's Complement Arithmetic and Overflow", 12],
    ['Fixed Point and Floating Point', 28], ['Boolean Algebra', 55], ['Minterms, Maxterms and Canonical Forms', 14],
    ['Karnaugh Maps', 33], ['Universal Gates and Functional Completeness', 12], ['Adders and Subtractors', 11],
    ['Multiplication in Hardware', 4], ['Multiplexers, Decoders and Encoders', 25], ['Memory Basics', 10],
    ['Latches and Flip-Flops', 31], ['Registers and Counters', 18], ['Finite State Machines', 7],
    ['Timing and Hazards', 4]
  ]],
  ['coa', 'Computer Organization & Architecture', 'COA', 414, 251, [
    ['Instruction Cycle and Addressing Modes', 20], ['Instruction Formats, Expanding Opcodes and ISA Design', 16],
    ['Assembly Programs, Flags and Register Transfers', 17], ['RISC, CISC and Processor Performance', 10],
    ['Datapath, Hardwired Control and Microprogramming', 20], ['Pipelining: Timing, Speedup and Stage Design', 20],
    ['Pipeline Hazards, Forwarding and Branches', 30], ['Cache Concepts and Locality', 11],
    ['Cache Mapping and Address Bits', 40], ['Replacement, Write Policies and Hit/Miss Tracing', 10],
    ['Average Memory Access Time and Multilevel Caches', 18], ['Main Memory: DRAM, Interleaving and Chip Select', 7],
    ['Virtual Memory, TLB and Paging in the Pipeline', 4], ['Interrupts and Exceptions', 12],
    ['DMA and I/O Transfer Modes', 12], ['Disks and Storage', 4]
  ]],
  ['os', 'Operating Systems', 'OS', 532, 343, [
    ['Processes, Context Switch and System Calls', 21], ['Fork and Process Creation', 7], ['CPU Scheduling', 45],
    ['Process Synchronization', 54], ['Semaphores and Monitors', 11], ['Deadlock', 34], ['Threads', 10],
    ['Memory Management: Partitions and Allocation', 10], ['Paging, Page Tables and TLB', 30],
    ['Virtual Memory and Page Replacement', 53], ['I/O, Interrupts and DMA', 15],
    ['Disk Structure and Performance', 21], ['Disk Scheduling', 16], ['File Systems', 16]
  ]],
  ['dbms', 'Database Management Systems', 'DBMS', 525, 302, [
    ["Functional Dependencies and Armstrong's Axioms", 1], ['Disk Blocks, B-Trees and B+ Trees', 32],
    ['Keys and Attribute Closure', 7], ['Transactions, Schedules and Serializability', 12],
    ['Normalization, Decomposition and Minimal Cover', 59], ['The Entity-Relationship (ER) Model', 15],
    ['File Organization and Indexing', 15], ['Relational Algebra, Joins and Join Cost', 21],
    ['SQL You Need for These Questions', 35], ['Relational Calculus and Expressive Power', 73],
    ['ACID, Locking, Timestamps, Deadlock and Recovery', 32]
  ]],
  ['cn', 'Computer Networks', 'CN', 449, 226, [
    ['Layering, OSI and TCP/IP Models', 8], ['Switching, Delay and Throughput', 9],
    ['Application Layer Protocols', 16], ['Framing, Error Detection and Correction', 18],
    ['Flow Control and ARQ (Stop-and-Wait, Sliding Window)', 29], ['Ethernet and Medium Access Control', 18],
    ['Bridges, Switches and ARP', 13], ['IPv4 Datagram, Fragmentation and ICMP', 27],
    ['IP Addressing, Subnetting and CIDR', 28], ['Routing Algorithms and Protocols', 17],
    ['UDP, Sockets and the Transport Layer', 9], ['TCP: Segments, Connections and Reliability', 22],
    ['TCP Congestion Control', 10], ['Traffic Shaping: Token Bucket', 2]
  ]],
  ['ml', 'Mathematical Logic', 'Logic', 86, 78, [
    ['First-Order (Predicate) Logic', 35], ['Propositional Logic', 43]
  ]],
  ['sta', 'Set Theory & Algebra', 'Sets', 290, 173, [
    ['Binary Operation', 8], ['Countable Set', 2], ['Functions', 30], ['Group', 34],
    ['Lattice & Hasse Diagrams', 10], ['Mathematical Induction', 2], ['Number Theory', 7],
    ['Partial Order', 11], ['Polynomials', 4], ['Relations', 38], ['Sets', 27]
  ]],
  ['comb', 'Combinatorics', 'Comb', 72, 51, [
    ['Gaps, Stars and Bars', 5], ['Arrangements and Choices', 9], ['Lattice Paths and Restrictions', 10],
    ['Catalan Numbers', 2], ['Substrings, Subsets, Functions', 4], ['Generating Functions', 6],
    ['Modular Arithmetic, Pigeonhole', 4], ['Recurrences and Induction', 5], ['Sums, Series and Proofs', 6]
  ]],
  ['gt', 'Graph Theory', 'Graphs', 146, 88, [
    ['Counting Graphs', 4], ['Degrees and Degree Sequences', 13], ['Graph Colouring', 12],
    ['Independent Sets and Vertex Covers', 4], ['Representing Graphs: Adjacency Lists and Matrices', 5],
    ['Connectivity, Components and Cuts', 9], ['Trees, Forests and Spanning Trees', 12],
    ['Special Graphs: Bipartite, Eulerian, Line Graphs', 8], ['Isomorphism and Complements', 5],
    ['Matchings', 2], ['Planar Graphs', 14]
  ]],
  ['prob', 'Probability', 'Prob', 241, 125, [
    ["Bayes' Theorem and Networks", 5], ['Bernoulli and Binomial Trials', 9], ['Conditional Probability', 14],
    ['Expectation and Variance', 16], ['Exponential Distribution', 6], ['Independent Events', 6],
    ['Normal Distribution', 4], ['Poisson Distribution', 5], ['Basic Probability and Counting', 31],
    ['Random Variables, PDF, CDF', 16], ['Uniform Distribution', 11], ['Functions of Random Variables', 2]
  ]],
  ['la', 'Linear Algebra', 'LA', 279, 112, [
    ['Coordinate Geometry', 1], ['Determinants', 12], ['Eigenvalues & Eigenvectors', 33], ['Gaussian Elimination', 1],
    ['LU Decomposition', 3], ['Matrix Algebra', 24], ['Multiplicity of Eigenvalues', 1],
    ['Orthonormality & Projections', 2], ['Rank & Rank-Nullity', 7], ['Singular Value Decomposition (SVD)', 1],
    ['Invertibility & Diagonalisation', 2], ['Subspaces', 1], ['Systems of Linear Equations', 17],
    ['Vector Spaces', 7]
  ]],
  ['calc', 'Calculus', 'Calc', 83, 69, [
    ['Continuity and Differentiability', 11], ['Integral Properties & Symmetry', 4], ['Differentiation', 11],
    ['Evaluating Definite Integrals', 11], ['Limits', 15], ['Maxima, Minima and Roots', 14],
    ['Polynomial Roots and Series', 3]
  ]],
  ['ga', 'General Aptitude', 'GA', 336, 430, []]
];

/* Real first page of each topic in the PDF (from the book TOC analysis). Used as the default page start. */
const START = {"c":[10,12,13,27,30,32,39,47,56,69,85,87,119,122,141,142,144,150,153,154,155],"ds":[10,15,27,50,75,109,112,124,128,147,160,174],"algo":[9,91,164,274,290,417,441,454,570,607,696,726,757,786],"toc":[10,89,134,144,183,194,248,312,342,390,407,413,441],"cd":[10,27,42,87,107,151,207,247,272,293,306,324,376],"dl":[13,53,97,122,175,276,306,363,385,412,423,473,489,566,604,622],"coa":[10,37,63,97,113,147,181,234,247,310,329,356,368,375,390,407],"os":[9,34,45,116,211,231,296,310,327,371,446,459,487,510],"dbms":[12,17,78,89,115,207,232,254,288,342,468],"cn":[9,23,44,77,113,168,200,228,278,339,373,388,425,444],"ml":[11,46],"sta":[5,18,21,71,132,148,151,160,179,188,248],"comb":[11,17,27,39,42,48,56,60,66],"gt":[5,11,29,46,53,63,82,99,114,123,127],"prob":[9,20,39,64,96,107,118,125,133,186,215,237],"la":[7,11,40,115,118,127,184,186,192,206,209,216,219,264],"calc":[9,23,29,41,53,66,80]};

const SUBJECTS = RAW.map((r, i) => ({
  id: r[0], name: r[1], short: r[2], pages: r[3], questions: r[4],
  topics: r[5].map((t, k) => ({ n: t[0], q: t[1], s: (START[r[0]] || [])[k] })),
  hue: Math.round(i * 20)
}));

if (typeof module !== 'undefined') module.exports = { SUBJECTS };

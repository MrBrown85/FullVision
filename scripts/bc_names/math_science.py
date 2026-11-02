"""Name rules for Mathematics and Science.

See scripts/bc_names/README.md for how a rule is written.
"""

COURSES = [
    "MATH8", "MATH9", "FPC10", "WPM10", "CS11", "FOM11", "HOM11", "PC11",
    "WPM11", "APPM12", "CALC12", "CS12", "FOM12", "GEOM12", "PC12", "STAT12",
    "SCI8", "SCI9", "SCI10", "CHEM11", "EARTH11", "ENVSCI11", "LS11SCI", "PHYS11",
    "SFC11", "ANAT12", "CHEM12", "ENVSCI12", "GEO12", "PHYS12", "SPSCI12",
]

RULES = [
    # Mathematics: Reasoning and modelling / Reasoning and analyzing
    (r"solve (historical )?puzzles and play games", "Puzzles & Games"),
    (r"^Use reasoning and logic to explore, analyze, and apply", "Logical Reasoning"),
    (r"^Explore, analyze, and apply .* using reason", "Logical Reasoning"),
    (r"^Estimate reasonably", "Estimation"),
    (r"^Demonstrate and apply mental math", "Mental Math"),
    (r"test conjectures", "Testing Conjectures"),
    (r"^Model (with )?(mathematics|statistics) in", "Modelling in Context"),
    (r"^Think creatively and with curiosity", "Problem Exploration"),
    (r"analyze and create algorithms", "Creating Algorithms"),
    (r"^Engage in spatial reasoning", "Spatial Reasoning"),
    # Mathematics: Understanding and solving
    (r"^Apply multiple strategies to solve problems", "Solution Strategies"),
    (r"^Apply flexible and strategic approaches to solve problems", "Solution Strategies"),
    (r"^Apply flexible and strategic approaches to explore statistical questions", "Question Strategies"),
    (r"^Solve problems with persistence", "Persistent Solving"),
    (r"^Explore research questions with persistence", "Research Questions"),
    (r"^Develop, demonstrate, and apply .*understanding", "Concept Development"),
    (r"^Visualize to explore", "Visualization"),
    (r"^Engage in statistical thinking .* place, story", "Place-Based Thinking"),
    (r"^Engage in problem-solving experiences .*place, story", "Place-Based Problems"),
    (r"^Critique multiple strategies", "Strategy Critique"),
    # Mathematics: Communicating and representing
    (r"^Use geometric vocabulary", "Geometric Vocabulary"),
    (r"^Use statistical vocabulary", "Statistical Language"),
    (r"^Use (computer science and )?mathematical vocabulary", "Math Vocabulary"),
    (r"^Explain(,)? (and )?justify", "Justification"),
    (r"^Communicate mathematical thinking", "Math Communication"),
    (r"^Represent .* ideas in concrete, pictorial", "Representation"),
    (r"^Use historical symbolic representations", "Historical Symbols"),
    (r"^Take risks when offering ideas", "Offering Ideas"),
    # Mathematics: Connecting and reflecting
    (r"^Reflect on the consequences of mathematics", "Consequences of Math"),
    (r"^Reflect on (mathematical|geometric|statistical)", "Reflection"),
    (r"^Connect (mathematical|statistical)", "Making Connections"),
    (r"^Use mathematical arguments to support personal choices", "Supporting Choices"),
    (r"^Incorporate First Peoples worldviews", "First Peoples Views"),
    (r"^Use mistakes as opportunities", "Using Mistakes"),
    # Science: Questioning and predicting
    (r"^Demonstrate a sustained intellectual curiosity", "Sustained Inquiry"),
    (r"^Make observations aimed at identifying their own questions", "Observation"),
    (r"^Identify a question to answer", "Inquiry Questions"),
    (r"hypotheses", "Hypotheses"),
    (r"^Make predictions", "Predictions"),
    # Science: Planning and conducting
    (r"plan,? .*investigation (types|methods)", "Investigation Plans"),
    (r"^Measure and control variables", "Variable Control"),
    (r"^Observe, measure, and record data", "Data Recording"),
    (r"^Use appropriate SI units and perform simple unit conversions", "Unit Conversions"),
    (r"collect and record data", "Data Collection"),
    (r"^Ensure that safety and ethical guidelines", "Safety & Ethics"),
    (r"^Assess risks in the context of personal safety", "Risk Assessment"),
    (r"^Assess risks and address ethical", "Method Risks"),
    (r"^Apply the concepts of accuracy and precision", "Accuracy & Precision"),
    # Science: Processing and analyzing data and information
    (r"experience and interpret the local environment", "Local Environment"),
    (r"^Apply First Peoples perspectives and knowledge, other ways of knowing", "Ways of Knowing"),
    (r"^Construct and use a range of methods to represent patterns", "Data Representation"),
    (r"^Seek (and analyze )?patterns", "Data Patterns"),
    (r"draw conclusions", "Drawing Conclusions"),
    (r"^Construct, analyze,? and interpret graphs", "Graphs & Models"),
    (r"^Analyze cause-and-effect relationships", "Cause & Effect"),
    # Science: Evaluating
    (r"^Reflect on their investigation methods", "Method Reflection"),
    (r"^Identify possible sources of error", "Sources of Error"),
    (r"^Evaluate their methods and experimental conditions", "Method Evaluation"),
    (r"^Describe specific ways to improve their investigation methods", "Method Improvement"),
    (r"^Demonstrate an awareness of assumptions", "Assumptions & Bias"),
    (r"^Demonstrate an understanding and appreciation of evidence", "Evidence"),
    (r"^Exercise a healthy, informed skepticism", "Informed Skepticism"),
    (r"^Consider social, ethical, and environmental implications", "Implications"),
    (r"^Evaluate the validity and limitations of a model", "Model Limitations"),
    (r"^Consider the changes in knowledge over time", "Changing Knowledge"),
    (r"^Connect scientific explorations to careers", "Science Careers"),
    (r"^Critically analyze the validity of information", "Source Validity"),
    # Science: Applying and innovating
    (r"^Contribute to care for self, others", "Contributing to Care"),
    (r"^Co-?operatively design projects", "Project Design"),
    (r"^Transfer and apply learning", "Transfer of Learning"),
    (r"^Generate and introduce new or refined ideas", "Idea Generation"),
    (r"^Contribute to finding solutions", "Finding Solutions"),
    (r"^Consider the role of scientists in innovation", "Role of Scientists"),
    (r"^Implement multiple strategies to solve problems", "Solution Strategies"),
    # Science: Communicating
    (r"^Communicate ideas, findings, and solutions", "Sharing Findings"),
    (r"^Communicate scientific ideas", "Scientific Argument"),
    (r"^Express and reflect on a variety of experiences", "Place Perspectives"),
    (r"^Formulate physical or mental theoretical models", "Theoretical Models"),
]

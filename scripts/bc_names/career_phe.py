"""Name rules for Career Education and Physical and Health Education.

See scripts/bc_names/README.md for how a rule is written.
"""

COURSES = [
    "CAREE8", "CAREE9", "CLE10", "YWT11", "CLC12", "WEX12A", "WEX12B", "YWT12",
    "PHE8", "PHE9", "PHE10", "AL11", "FC11", "ODED11", "AL12", "FC12",
    "ODED12",
]

RULES = [
    # Career Education 8-9
    (r"^Use self-assessment and reflection", "Self-Assessment"),
    (r"individual purposes and passions", "Purpose and Passion"),
    (r"personal public identity", "Public Identity"),
    (r"^Demonstrate respect, collaboration, and inclusivity", "Collaboration"),
    (r"diverse perspectives on how work contributes", "Perspectives on Work"),
    (r"^Demonstrate safety skills", "Workplace Safety"),
    (r"^Set and achieve realistic learning goals", "Goal Setting"),
    (r"influence of curriculum choices", "Curriculum Choices"),
    (r"network of resources and mentors", "Networks and Mentors"),
    (r"family expectations and traditions", "Family Expectations"),
    (r"research skills to expand their knowledge of diverse career", "Career Research"),
    (r"^Explore volunteer and other new learning experiences", "Volunteer Experience"),
    (r"^Apply decision-making strategies", "Decision-Making"),

    # Career-Life Education 10 and Career-Life Connections 12: profiles and networks
    (r"^Examine the influences of personal and public profiles", "Public Profiles"),
    (r"^Create and critique personal and public profiles", "Profile Creation"),
    (r"^Develop preliminary profiles and flexible plans", "Career-Life Plans"),
    (r"digital footprints", "Digital Footprints"),
    (r"^Consider the role of personal and employment networks", "Employment Networks"),
    (r"^Engage with personal, education, and employment networks", "Networking"),
    (r"^Apply a mentor|^Collaborate with a mentor", "Mentorship"),
    (r"^Collaborate with supportive community members", "Career-Life Choices"),
    (r"^Communicate with the intent to highlight personal strengths", "Sharing Strengths"),
    (r"inclusive, respectful, and safe interactions", "Safe Interactions"),

    # Career-Life Education 10 and Career-Life Connections 12: experience and planning
    (r"^Identify career-life challenges and opportunities", "Career Challenges"),
    (r"^Explore and connect experiential learning", "Learning Connections"),
    (r"school/work/life balance", "Work-Life Balance"),
    (r"^Explore and reflect on career-life roles", "Career-Life Roles"),
    (r"^Recognize personal worldviews", "Worldviews"),
    (r"for post-graduation planning", "Graduation Planning"),
    (r"^Assess personal transferable skills", "Skills Assessment"),
    (r"personal strategies, including social, physical, and financial", "Wellness Strategies"),
    (r"^Explore possibilities for preferred personal", "Preferred Futures"),
    (r"preferred approaches to learning", "Learning Approaches"),
    (r"^Engage in, reflect on, and evaluate career-life exploration", "Career Exploration"),
    (r"share highlights of their learning journey", "Learning Highlights"),
    (r"present a capstone", "Capstone"),

    # Work Experience 12 and Youth Work in Trades 11-12: placement and skills
    (r"^Collaborate with teacher and employer", "Training Plan"),
    (r"refine their trade-specific training plan", "Plan Refinement"),
    (r"apply trade-specific skills", "Trade Skills"),
    (r"transferr?able skills specific to the work placement", "Transferable Skills"),
    (r"^Explore (further )?work placement opportunities", "Work Placements"),
    (r"novel and guided approaches to utilize personal strengths", "Personal Strengths"),
    (r"^Assess knowledge of self", "Personal Interests"),
    (r"job search and interview skills", "Job Search"),
    (r"plan to address skill development", "Skill Development"),
    (r"^Demonstrate progression of skills", "Skill Progression"),
    (r"demonstrate required hours", "Hours Documentation"),

    # Work Experience 12 and Youth Work in Trades 11-12: workplace conduct and safety
    (r"work respectfully and constructively", "Respectful Work"),
    (r"workplace ethics and etiquette", "Workplace Ethics"),
    (r"care of self, others, and community", "Community Care"),
    (r"determine workplace safety risks", "Risk Identification"),
    (r"site-specific work-site safety procedures", "Safety Procedures"),

    # Work Experience 12 and Youth Work in Trades 11-12: reflection
    (r"documentation of work experience as it relates", "Pathway Reflection"),
    (r"documentation of work experience to identify strengths", "Work Reflection"),
    (r"collaborative problem-solving strategies", "Problem Solving"),

    # PHE 8-10 and Active Living: physical literacy and participation
    (r"movement skills", "Movement Skills"),
    (r"movement concepts", "Movement Concepts"),
    (r"monitoring and adjusting exertion|^Monitor exertion levels", "Exertion Monitoring"),
    (r"safety, fair play, and leadership", "Safety and Fair Play"),
    (r"preferred types of physical activity", "Activity Preferences"),
    (r"motivational factors", "Motivational Factors"),
    (r"designed to enhance and maintain health components of fitness", "Fitness Activity"),
    (r"participation in physical activities at school|^Describe the relationships between physical activities|^Describe the impact of various types of physical activities", "Activity and Health"),
    (r"increase confidence and encourage lifelong", "Lifelong Activity"),
    (r"overcome potential barriers", "Overcoming Barriers"),
    (r"plan, organize, and safely participate", "Event Planning"),
    (r"^Demonstrate safe and appropriate participation", "Safe Participation"),
    (r"^Engage in a variety of recreational activities", "Recreation"),
    (r"^Refine strategies to effectively participate", "Activity Strategies"),
    (r"recreation leadership", "Activity Leadership"),
    (r"prevents injury|reduces the chance of injury", "Injury Prevention"),

    # PHE 8-10 and Active Living: healthy living
    (r"healthy eating", "Healthy Eating"),
    (r"healthy choices", "Healthy Choices"),
    (r"health messages", "Health Messages"),
    (r"^Reflect on outcomes of personal healthy-living goals", "Goal Reflection"),
    (r"health-related decisions|reasoned decision-making related to their personal health", "Health Decisions"),
    (r"strategies to pursue personal healthy-living goals", "Healthy-Living Goals"),
    (r"importance of maintaining personal health", "Maintaining Health"),

    # PHE 8-10: social and community health
    (r"unsafe, abusive, or exploit", "Safety Strategies"),
    (r"discrimination, stereotyping, and bullying", "Bullying Responses"),
    (r"healthy relationships", "Relationship Skills"),
    (r"health and well-being of the school and community", "Community Health"),
    (r"effects of social influences", "Social Influences"),

    # PHE 8-10: mental well-being
    (r"strategies for promoting mental well-being", "Promoting Well-Being"),
    (r"managing problems related to mental well-being and substance use", "Supporting Others"),
    (r"factors contributing to substance use", "Substance Use Causes"),
    (r"changes during puberty", "Managing Change"),
    (r"impact of transition and change on identities", "Identity and Change"),
    (r"factors that shape personal identities", "Identity Factors"),

    # Fitness and Conditioning 11-12
    (r"pursue personal fitness goals", "Fitness Goals"),
    (r"relationships between lifestyle patterns", "Lifestyle Analysis"),
    (r"fitness myths and fads", "Fitness Myths"),
    (r"how muscles produce movement", "Muscle Training"),
    (r"influences of different training styles", "Training Styles"),
    (r"appropriate exercise techniques", "Exercise Technique"),
    (r"personalized fitness program", "Fitness Planning"),
    (r"influence the muscular", "Body Systems"),
    (r"^Demonstrate a variety of leadership skills", "Leadership Skills"),
    (r"appropriate behaviours in different types of fitness", "Appropriate Conduct"),
    (r"^Apply safety practices", "Safety Practices"),

    # Outdoor Education 11-12
    (r"^Participate in (and lead )?a variety of outdoor activities", "Outdoor Activities"),
    (r"skills for outdoor activities", "Outdoor Skills"),
    (r"^Monitor environmental conditions", "Condition Monitoring"),
    (r"nutritional considerations", "Outdoor Preparation"),
    (r"^Understand their strengths and areas for growth", "Strengths and Growth"),
    (r"reduce potential impacts of outdoor activities", "Impact Reduction"),
    (r"cultural and place-based sensitivities", "Cultural Sensitivity"),
    (r"^Communicate and collaborate effectively", "Communication"),
    (r"^Collaborate with others in a variety of outdoor", "Collaboration"),
    (r"outdoor leadership skills", "Leadership Skills"),
    (r"^Use applicable communication skills", "Communication Skills"),
    (r"responses to emergency situations", "Emergency Response"),
    (r"responsibility for personal safety", "Personal Safety"),
    (r"manage risks", "Risk Management"),
]

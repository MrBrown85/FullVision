"""Name rules for English Language Arts.

See scripts/bc_names/README.md for how a rule is written.
"""

COURSES = [
    "ELA8", "ELA9", "COMP10", "CW10", "EFPLS10", "EFPNM10", "EFPSL10", "EFPW10",
    "LS10", "NM10", "SL10", "COMP11", "CW11", "EFPLSNM11", "EFPLSSL11", "EFPLSW11",
    "LS11", "NMED11", "SPKN11", "COMP12", "CW12", "EFP12", "ES12", "LS12",
    "NMED12", "SPKN12",
]

RULES = [
    # Comprehend and connect: reading, sources and strategies
    (r"^Read for enjoyment", "Personal Reading"),
    (r"^(Access|Use) information", "Information Access"),
    (r"relevance, accuracy, and reliability of texts", "Text Reliability"),
    (r"^Synthesize ideas", "Idea Synthesis"),
    (r"strategies .*comprehend", "Text Comprehension"),
    (r"^Discern nuances", "Word Nuances"),
    (r"^Identify bias", "Bias & Distortion"),

    # Comprehend and connect: form, structure and literary craft
    (r"text structures and (understand )?how they contribute", "Text Structures"),
    (r"forms?, (formats, )?(structures, )?(and )?(features|genres).*reflect", "Text Form & Purpose"),
    (r"features, forms, and genres of texts reflect", "Text Form & Purpose"),
    (r"forms, formats, structures, and features of texts enhance", "Text Form & Meaning"),
    (r"new media techniques and devices reflect", "Media Techniques"),
    (r"^Examine how specific new media techniques", "New Media Techniques"),
    (r"literary elements.*(new media )?techniques.*enhance", "Literary Devices"),
    (r"^Evaluate how techniques and devices", "Techniques & Devices"),

    # Comprehend and connect: thinking, response and identity
    (r"^Think critically.*to explore ideas", "Idea Exploration"),
    (r"^Think critically.*to analyze ideas", "Idea Analysis"),
    (r"contexts, values, and perspectives in (oral and other )?texts, including", "Contexts & Values"),
    (r"^Recognize and analyze personal, social, cultural contexts", "Contexts & Values"),
    (r"^Recognize personal, social, and cultural contexts, as well as", "Contexts & Values"),
    (r"contexts, values, and perspectives in", "Text Perspectives"),
    (r"identities in First Peoples texts", "Identity in Texts"),
    (r"how language (constructs|reflects)", "Language & Identity"),
    (r"^Construct meaningful personal connections", "Personal Connections"),

    # Comprehend and connect: First Peoples texts and perspectives
    (r"role of oral traditions in First Peoples cultures", "Oral Traditions"),
    (r"roles? of story", "Story & Tradition"),
    (r"protocols and ownership", "Protocol & Ownership"),
    (r"diversity (within and across|among) First Peoples", "Cultural Diversity"),
    (r"influence of (land/)?place", "Influence of Place"),
    (r"First Peoples languages and texts reflect", "Language & Worldview"),
    (r"new media affect First Peoples", "New Media Effects"),
    (r"authenticity of First Peoples", "Text Authenticity"),
    (r"terms/words from First Peoples languages", "First Peoples Terms"),

    # Comprehend and connect: digital citizenship and media
    (r"^Understand and appreciate the complexities of digital", "Digital Complexities"),
    (r"digital citizen", "Digital Citizenship"),
    (r"new media impacts social activism", "Media & Activism"),
    (r"suitability of selected media", "Media Suitability"),

    # Create and communicate: exchanging ideas, speaking and listening
    (r"exchange ideas and viewpoints", "Idea Exchange"),
    (r"^Respond to text", "Personal Response"),
    (r"speaking and listening skills", "Speaking & Listening"),
    (r"(spoken|oral) (language|communication) formats?", "Oral Formats"),
    (r"techniques to engage listeners", "Listener Engagement"),
    (r"oral storytelling", "Oral Storytelling"),

    # Create and communicate: planning, drafting and refining texts
    (r"^Use digital and multimedia writing and design", "Multimedia Design"),
    (r"^Use writing and multimedia design", "Multimedia Design"),
    (r"^Use (writing and other )?creative processes", "Creative Process"),
    (r"^Use writing and design processes", "Writing Process"),
    (r"refine (oral and other |oral )?texts", "Text Refinement"),
    (r"conventions of", "Writing Conventions"),
    (r"opinion", "Opinion & Evidence"),
    (r"^Transform ideas and information", "Idea Transformation"),

    # Create and communicate: form, style and language choices
    (r"^Select and use appropriate features, forms, and genres", "Form Selection"),
    (r"^Experiment with genres, forms, or styles", "Genre Experiments"),
    (r"^Select and use .*media appropriate", "Media Selection"),
    (r"^Manipulate language", "Purposeful Language"),
    (r"figurative as well as literal", "Figurative Language"),
    (r"techniques to engage meaningful texts", "Engaging Texts"),
    (r"writers’ practices", "Writing Practices"),
    (r"digital media to collaborate", "Media Collaboration"),

    # Create and communicate: intellectual property
    (r"acknowledgements and citations", "Source Citation"),
    (r"intellectual property rights and community protocols", "Rights & Protocols"),
]

/*
 * Word pairings for: BYO [word]  /  How can [plural] [verb] Science
 * Each noun lists only the verbs that read sensibly with it.
 * 'plural' is the grammatically natural line-2 form (mass nouns keep base form).
 * Loaded as a global so it works when index.html is opened directly (file://),
 * where fetch() of a local JSON would be blocked.
 */
window.WORD_DATA = {
  verbs: [
    "facilitate", "contribute to", "reconfigure", "transform", "translate",
    "communicate", "support", "challenge", "innovate", "decolonise"
  ],
  nouns: [
    { word: "BEAMER",         plural: "BEAMERS",        verbs: ["facilitate", "support", "communicate", "translate", "contribute to"] },
    { word: "SYNTHS",         plural: "SYNTHS",         verbs: ["communicate", "translate", "transform", "contribute to"] },
    { word: "MIXER",          plural: "MIXERS",         verbs: ["reconfigure", "transform", "facilitate", "support"] },
    { word: "CABLES",         plural: "CABLES",         verbs: ["support", "facilitate", "contribute to", "reconfigure"] },
    { word: "INSTRUMENT",     plural: "INSTRUMENTS",    verbs: ["facilitate", "support", "communicate", "translate", "contribute to"] },
    { word: "SPEAKER",        plural: "SPEAKERS",       verbs: ["communicate", "translate", "facilitate", "support"] },
    { word: "LAPTOP",         plural: "LAPTOPS",        verbs: ["facilitate", "support", "communicate", "contribute to"] },
    { word: "AMP",            plural: "AMPS",           verbs: ["support", "facilitate", "transform"] },
    { word: "LASER",          plural: "LASERS",         verbs: ["transform", "reconfigure", "communicate", "innovate"] },
    { word: "LIGHTS",         plural: "LIGHTS",         verbs: ["communicate", "transform", "facilitate", "support"] },
    { word: "CAMERA",         plural: "CAMERAS",        verbs: ["communicate", "translate", "support", "contribute to"] },
    { word: "IDEAS",          plural: "IDEAS",          verbs: ["transform", "challenge", "reconfigure", "communicate", "innovate", "contribute to", "decolonise"] },
    { word: "KNOWLEDGE",      plural: "KNOWLEDGE",      verbs: ["transform", "challenge", "communicate", "translate", "decolonise", "contribute to", "reconfigure"] },
    { word: "PRACTICE",       plural: "PRACTICES",      verbs: ["reconfigure", "transform", "challenge", "support", "decolonise"] },
    { word: "VISION",         plural: "VISIONS",        verbs: ["communicate", "transform", "challenge", "innovate", "translate"] },
    { word: "FUTURES",        plural: "FUTURES",        verbs: ["reconfigure", "transform", "challenge", "innovate", "decolonise"] },
    { word: "ACT",            plural: "ACTS",           verbs: ["transform", "challenge", "support", "contribute to"] },
    { word: "CONCEPT",        plural: "CONCEPTS",       verbs: ["communicate", "translate", "transform", "challenge", "reconfigure"] },
    { word: "ART",            plural: "ARTS",           verbs: ["communicate", "translate", "transform", "challenge", "decolonise", "innovate"] },
    { word: "FOG MACHINE",    plural: "FOG MACHINES",   verbs: ["transform", "reconfigure", "facilitate", "support"] },
    { word: "ROBOT",          plural: "ROBOTS",         verbs: ["facilitate", "support", "transform", "innovate", "reconfigure"] },
    { word: "LIGHTSABER",     plural: "LIGHTSABERS",    verbs: ["challenge", "transform", "innovate"] },
    { word: "PAINTBRUSH",     plural: "PAINTBRUSHES",   verbs: ["communicate", "translate", "transform", "contribute to"] },
    { word: "FIELD NOTES",    plural: "FIELD NOTES",    verbs: ["communicate", "translate", "contribute to", "support"] },
    { word: "RESEARCH DATA",  plural: "RESEARCH DATA",  verbs: ["transform", "communicate", "translate", "contribute to", "support", "challenge"] },
    { word: "PERSPECTIVE",    plural: "PERSPECTIVES",   verbs: ["reconfigure", "transform", "challenge", "communicate", "decolonise", "translate"] },
    { word: "ENTHUSIASM",     plural: "ENTHUSIASM",     verbs: ["support", "facilitate", "transform", "communicate", "contribute to"] },
    { word: "PURPOSE",        plural: "PURPOSES",       verbs: ["transform", "challenge", "support", "reconfigure", "contribute to"] },
    { word: "AGENDA",         plural: "AGENDAS",        verbs: ["reconfigure", "transform", "challenge", "decolonise", "support"] },
    { word: "URGENCY",        plural: "URGENCY",        verbs: ["communicate", "transform", "challenge", "support", "facilitate"] },
    { word: "COMMITMENT",     plural: "COMMITMENTS",    verbs: ["support", "transform", "challenge", "contribute to", "facilitate"] },
    { word: "QUESTION",       plural: "QUESTIONS",      verbs: ["challenge", "reconfigure", "transform", "communicate", "decolonise"] },
    { word: "INQUIRY",        plural: "INQUIRIES",      verbs: ["facilitate", "support", "transform", "challenge", "decolonise", "contribute to"] },
    { word: "FUTURE",         plural: "FUTURES",        verbs: ["reconfigure", "transform", "challenge", "innovate", "decolonise"] },
    { word: "STRATEGY",       plural: "STRATEGIES",     verbs: ["reconfigure", "transform", "facilitate", "support", "innovate", "contribute to"] },
    { word: "CLIMATE ACTION", plural: "CLIMATE ACTION", verbs: ["facilitate", "support", "transform", "challenge", "contribute to", "innovate"] }
  ]
};

/**
 * The competency-to-skill table against the whole curriculum (lane H,
 * Nov 1): every competency in curriculum_by_course.json run through
 * CommentBank.skillOf for its course's kind of class.
 *
 * (a) A competency that main's table routed to a skill keeps that skill:
 *     the new rows sit after the original ones in each family, so they
 *     catch only labels that had no skill before.
 * (b) A curated list of competencies across the new families lands on
 *     the skill a teacher of that course would expect.
 * (c) A label from another subject's course that shares a generic word
 *     (a Dance course's "choreography", "contemporary", a Food Studies
 *     research competency, "machine learning", "social media") does not
 *     land on a new row of a family it does not belong to, and every
 *     course's competencies route only through its own family's table.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const COURSES = JSON.parse(readFileSync('curriculum_by_course.json', 'utf-8'));
const FAMILY = {
  'Applied Design, Skills and Technologies': 'adst',
  'Arts Education': 'arts',
  'Career Education': 'career',
  'English Language Arts': 'ela',
  Mathematics: 'math',
  'Physical and Health Education': 'pe',
  Science: 'science',
  'Social Studies': 'socials',
};
// The skills each family had before lane H, in their order on main.
const ORIGINAL = {
  socials: ['ethical', 'significance', 'perspective', 'cause', 'continuity', 'evidence', 'inquiry'],
  science: ['evaluating', 'questioning', 'planning', 'processing', 'applying', 'communicating'],
  math: ['communicating', 'connecting', 'reasoning', 'solving'],
  ela: ['conventions', 'revising', 'speaking', 'information', 'reading', 'thinking', 'writing'],
  arts: ['reflecting', 'creating', 'communicating', 'connecting', 'technique'],
  pe: ['safety', 'wellbeing', 'leading', 'fitness', 'movement'],
  adst: ['testing', 'sharing', 'tools', 'designing', 'making'],
  career: ['self', 'connecting', 'exploring', 'planning'],
};
const competencies = [];
Object.entries(COURSES).forEach(([code, c]) =>
  (c.categories || []).forEach(cat =>
    (cat.competencies || []).forEach(cc =>
      competencies.push({ code, family: FAMILY[c.subject], category: cat.name, label: cc.short_label }),
    ),
  ),
);
/* The skill main's table gave a label: the first original row that matches. */
function originalKey(family, label) {
  const rows = CommentBank.SKILLS[family].filter(r => ORIGINAL[family].indexOf(r.key) >= 0);
  const row = rows.find(r => r.match.test(label));
  return row ? row.key : null;
}
const keyOf = (family, label) => {
  const sk = CommentBank.skillOf(family, label);
  return sk ? sk.key : null;
};

describe('the skill table against curriculum_by_course.json', () => {
  it('reads every course and competency, in a known kind of class', () => {
    // The rebuilt bank (stage 6): 226 courses, 5,029 competencies.
    expect(competencies.length).toBe(5029);
    competencies.forEach(c => expect(c.family, c.code).toBeTruthy());
    Object.keys(ORIGINAL).forEach(fam =>
      ORIGINAL[fam].forEach(key =>
        expect(
          CommentBank.SKILLS[fam].map(r => r.key),
          fam,
        ).toContain(key),
      ),
    );
  });

  it('(a) keeps every competency that had a skill on main on that same skill', () => {
    // Bank names a reviewer found wrong for their skill (CommentBank.NO_SKILL)
    // route to no skill on purpose (tests/comment-bank-routing-main.test.js).
    const excluded = (family, label) =>
      (CommentBank.NO_SKILL[family] || []).some(n => n.toLowerCase() === label.toLowerCase());
    const changed = competencies
      .map(c => ({ ...c, was: originalKey(c.family, c.label), now: keyOf(c.family, c.label) }))
      .filter(c => c.was && c.was !== c.now && !excluded(c.family, c.label));
    expect(changed).toEqual([]);
    // The original rows come first in every family, so the rule holds by
    // construction and the new rows catch only what fell through.
    Object.keys(ORIGINAL).forEach(fam => {
      const keys = CommentBank.SKILLS[fam].map(r => r.key);
      expect(keys.slice(0, ORIGINAL[fam].length), fam).toEqual(ORIGINAL[fam]);
    });
  });

  it('(b) routes a curated set of competencies to the skill a teacher would expect', () => {
    const EXPECT = [
      // Math
      ['math', 'Estimating and Mental Math', 'estimating'],
      ['math', 'Number Sense', 'estimating'],
      ['math', 'Sequences and Series', 'patterns'],
      ['math', 'Graphs and Tables', 'graphs'],
      ['math', 'Graphing Relations', 'graphs'],
      ['math', 'Notation and Units', 'notation'],
      ['math', 'Algebraic Expressions', 'notation'],
      ['math', 'Real-World Applications', 'wordProblems'],
      ['math', 'Applications of Trigonometry', 'wordProblems'],
      ['math', 'Procedures and Accuracy', 'procedures'],
      ['math', 'Mental Calculation', 'procedures'],
      // Career
      ['career', 'Examining Influences', 'influences'],
      ['career', 'Résumés and Interviews', 'interview'],
      ['career', 'Cover Letter', 'interview'],
      ['career', 'Budgeting', 'budgeting'],
      ['career', 'Income and Spending', 'budgeting'],
      ['career', 'Post-Secondary Options', 'postSecondary'],
      ['career', 'Apprenticeship Pathways', 'postSecondary'],
      // ADST
      ['adst', 'Safety Practices', 'safety'],
      ['adst', 'Food Safety Standards', 'safety'],
      ['adst', 'Operating Woodworking Machinery Safely', 'safety'],
      ['adst', 'Coordinating Kitchen Operations', 'foodPrep'],
      ['adst', 'Apply Knife', 'foodPrep'],
      ['adst', 'Recipes and Kitchen Skills', 'foodPrep'],
      ['adst', 'Complete Garments', 'sewing'],
      ['adst', 'Creating Patterns', 'sewing'],
      ['adst', 'Textile Structures', 'sewing'],
      ['adst', 'Knitting and Fiber Joining', 'sewing'],
      ['adst', 'Cutting and Shaping Metal', 'fabricating'],
      ['adst', 'Lathe Operation', 'fabricating'],
      ['adst', 'Use Woodworking', 'fabricating'],
      ['adst', 'Assembling Furniture Using Proper Gluing', 'fabricating'],
      ['adst', 'Hand Drafting', 'drafting'],
      ['adst', 'Orthographic Projections', 'drafting'],
      ['adst', 'Blueprint Reading', 'drafting'],
      ['adst', 'Creating Accurate Technical Drawings', 'drafting'],
      ['adst', 'Data Structures and Algorithms', 'coding'],
      ['adst', 'Adding Interactivity with JavaScript', 'coding'],
      ['adst', 'Styling Websites with CSS', 'coding'],
      ['adst', 'Robotics Engineering', 'coding'],
      ['adst', 'Creating Animation and Motion Graphics', 'media'],
      ['adst', 'Brand Identity Systems', 'media'],
      ['adst', 'Use Web', 'media'],
      ['adst', 'Conducting Market Research', 'business'],
      ['adst', 'Executing Accounting Transactions', 'business'],
      ['adst', 'Apply E-Commerce', 'business'],
      ['adst', 'Applying Material Science Knowledge', 'materials'],
      ['adst', 'Understand Fiber', 'materials'],
      ['adst', 'Group Projects', 'collaborating'],
      // PE
      ['pe', 'Outdoor and Land-Based Activities', 'outdoor'],
      ['pe', 'Wilderness Navigation', 'outdoor'],
      ['pe', 'Game Strategy', 'strategy'],
      ['pe', 'Offensive and Defensive Tactics', 'strategy'],
      ['pe', 'Eating and Hydration', 'nutrition'],
      ['pe', 'Relationships and Consent', 'relationships'],
      ['pe', 'Substance Use', 'substances'],
      ['pe', 'Endurance and Pacing', 'pacing'],
      ['pe', 'Managing Stress', 'stress'],
      // Arts
      ['arts', 'Planning a Piece', 'planning'],
      ['arts', 'Storyboarding', 'planning'],
      ['arts', 'Feedback and Guidance', 'revising'],
      ['arts', 'Applying Design Principles', 'elements'],
      ['arts', 'Developing Ensemble Unity and Synchronized Movement', 'performing'],
      ['arts', 'Preparing Auditions and Repertoire', 'performing'],
      ['arts', 'Reading Notation', 'notation'],
      ['arts', 'Mastering Camera Fundamentals and Exposure Control', 'camera'],
      ['arts', 'Building a Portfolio of Design Work', 'documenting'],
      ['arts', 'Portfolio Development', 'documenting'],
      // Languages (no course in the file; the BC second-language wording)
      ['languages', 'Comprehend key information and supporting details in slow, clear speech', 'listening'],
      ['languages', 'Comprehend meaning in stories, information and conversations', 'listening'],
      ['languages', 'Engage in short conversations', 'speaking'],
      ['languages', 'Read short texts', 'reading'],
      ['languages', 'Narrate stories in writing', 'writing'],
      ['languages', 'Use vocabulary in context', 'vocabulary'],
      ['languages', 'Verb forms in the present', 'grammar'],
      ['languages', 'Describe cultural practices', 'culture'],
      ['languages', 'Respond to simple questions', 'communicating'],
      ['languages', 'Negotiate meaning', 'understanding'],
    ];
    expect(EXPECT.length).toBeGreaterThanOrEqual(60);
    EXPECT.forEach(([fam, label, key]) => expect(keyOf(fam, label), fam + ': ' + label).toBe(key));
  });

  it('(c) keeps a competency from another kind of course off the new rows, and in its own table', () => {
    // Labels the review of #611 found misrouted: each must not land on a
    // new row (null, or an original row, is right).
    const NOT = [
      ['arts', 'Creating Original Choreographic Works', 'performing'],
      ['arts', 'Personal Artistic Voice', 'performing'],
      ['arts', 'Recognizing Common Dance Injuries', 'performing'],
      ['arts', 'Analyzing Contemporary Music', 'elements'],
      ['arts', 'Contemporary and Modern Dance Technique', 'elements'],
      ['arts', 'Planning Trajectory Toward Professional Art Career', 'planning'],
      ['arts', 'Production Planning and Management', 'planning'],
      ['arts', 'Exploring Movement through Improvisation', 'revising'],
      ['arts', 'Develop Editing and Post-Production Skills', 'revising'],
      ['arts', 'Edit and Enhance Photographs', 'revising'],
      ['arts', 'Analyze Film Using Film Theory', 'camera'],
      ['arts', 'Analyze Film Using Film Theory', 'notation'],
      ['arts', 'Building Awareness of Photography Careers', 'camera'],
      ['arts', 'Designing and Implementing Lighting Systems', 'camera'],
      ['arts', 'Colour Theory', 'notation'],
      ['adst', 'Use Accounting Software', 'coding'],
      ['adst', 'Design Programs and Curricula for Early Childhood Education', 'coding'],
      ['adst', 'Implementing Data Security', 'coding'],
      ['adst', 'Artificial Intelligence and Machine Learning', 'fabricating'],
      ['adst', 'Cutting-edge Technologies', 'fabricating'],
      ['adst', 'Performing Maintenance Procedures on Vehicles', 'fabricating'],
      ['adst', 'Conducting Research on Food Systems', 'foodPrep'],
      ['adst', 'Apply Nutrition Knowledge to Food Planning', 'foodPrep'],
      ['adst', 'Accessing Resources and Information to Support Relationships', 'materials'],
      ['adst', 'Promotional Materials and Campaigns', 'materials'],
      ['adst', 'Planning PCB Layouts', 'media'],
      ['adst', 'Navigating Digital Communication and Social Media Responsibly', 'media'],
      ['adst', 'Planning Family and Financial Decisions', 'business'],
      ['adst', 'Making Informed Consumer and Financial Decisions', 'business'],
      ['pe', 'Describe and assess strategies for promoting mental well-being', 'strategy'],
      ['pe', 'Describe and assess strategies for managing substance use', 'strategy'],
      ['pe', 'Creating Marketing Campaigns', 'nutrition'],
      ['math', 'Orthographic Projections', 'graphs'],
      ['math', 'Ethics and Applications', 'wordProblems'],
      ['arts', 'Ensemble Heritage', 'performing'],
      ['languages', 'Designing Robotic Systems and Solutions', 'listening'],
    ];
    NOT.forEach(([fam, label, key]) => expect(keyOf(fam, label), fam + ': ' + label).not.toBe(key));
    // A course's competencies are routed through its own family's table
    // only, and land on that family's skills or on none.
    competencies.forEach(c => {
      const key = keyOf(c.family, c.label);
      if (key)
        expect(
          CommentBank.SKILLS[c.family].map(r => r.key),
          c.code + ': ' + c.label,
        ).toContain(key);
    });
  });
});

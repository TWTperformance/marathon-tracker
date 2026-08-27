// Static reference content for the "Plan" tab — lifting program, weekly skeleton,
// Wednesday variety rotation, autoregulation rules, milestones. Source: PDF plan.

const LIFTING_PROGRAM = {
  phase1: {
    label: 'Phase 1 — Lead-In & Foundation (Weeks 1–5)',
    monday: {
      title: 'Lower Body / Posterior Chain (PM, 3+ hrs after AM run)',
      exercises: [
        'Trap Bar Deadlift — 4x5 @ 70-75% 1RM',
        'Bulgarian Split Squat — 3x8/leg',
        'Single-Leg RDL — 3x8/leg',
        'Standing Calf Raise — 3x12',
        'Pallof Press — 3x10/side'
      ]
    },
    thursday: {
      title: 'Upper Body + Olympic Power',
      exercises: [
        'Power Clean (or Hang Clean) — 5x3 @ 70% 1RM, bar speed priority',
        'Push Press — 4x5',
        'Weighted Pull-Up or Row — 4x6',
        'Incline DB Bench Press — 3x8',
        'Hanging Leg Raise — 3x12'
      ]
    },
    tuesday: {
      title: 'Power/Plyo (optional, ~20 min, Weeks 2+)',
      exercises: [
        'Box Jumps — 4x5 (stick the landing)',
        'Broad Jumps — 3x5',
        'Med Ball Rotational Throw — 3x8/side'
      ]
    }
  },
  phase2: {
    label: 'Phase 2 — Build 1 & 2 (Weeks 6–13)',
    monday: {
      title: 'Lower Body (reduced volume, intensity maintained)',
      exercises: [
        'Trap Bar Deadlift — 3x4 @ 75-80% 1RM',
        'Front Squat or Goblet Squat — 3x6',
        'Single-Leg RDL — 2x8/leg',
        'Calf Raise — 2x12',
        'Pallof Press or Dead Bug — 2x10'
      ]
    },
    thursday: {
      title: 'Upper + Olympic Power',
      exercises: [
        'Power Clean — 4x3 @ 72-75%',
        'Push Press — 3x5',
        'Pull-Up/Row — 3x6',
        'Bench Press — 3x6',
        'Core — 2x12'
      ]
    },
    tuesday: {
      title: 'Power/Plyo (optional, trimmed, lower impact)',
      exercises: [
        'Box Jumps — 3x5',
        'Bounding — 3x20m'
      ],
      note: 'Skip Tuesday entirely the week before a step-back week’s long run if legs feel heavy.'
    }
  },
  phase3: {
    label: 'Phase 3 — Peak & Taper (Weeks 14–19)',
    monday: {
      title: 'Light Total-Body Maintenance',
      exercises: [
        'Trap Bar Deadlift — 2x3 @ 70% (light, fast bar speed)',
        'Goblet Squat — 2x8',
        'Core — 2x10'
      ]
    },
    thursday: {
      title: 'Light Upper/Oly',
      exercises: [
        'Power Clean — 2x3 @ 65-70% (feel, not load)',
        'Push Press — 2x5',
        'Pull-Up/Row — 2x8'
      ]
    },
    tuesday: {
      title: 'Dropped from Week 17 onward',
      exercises: [],
      note: 'No new stimulus this close to race day. Race week: no lifting after Sunday of Week 18 — optional light bodyweight activation only, 2 days before the race, if desired.'
    }
  }
};

// Returns 'phase1' | 'phase2' | 'phase3' | null (no lifting) for a given plan week number.
function liftingPhaseForWeek(week) {
  if (week >= 1 && week <= 5) return 'phase1';
  if (week >= 6 && week <= 13) return 'phase2';
  if (week >= 14 && week <= 18) return 'phase3';
  return null; // week 19 race week — no lifting after Sun of wk18
}

function tuesdayLiftApplies(week) {
  if (week === 1) return false; // optional Tue starts Weeks 2+
  if (week >= 17) return false; // dropped from Week 17 onward
  return true;
}

const WEDNESDAY_VARIETY = [
  { name: 'Steady + Strides', detail: 'Continuous easy-moderate run, finish with 4-8 x 20-30 sec relaxed accelerations.' },
  { name: 'Progression run', detail: 'Start easy, gradually build pace through the run, finish moderately brisk (effort-guided, not watch-guided).' },
  { name: 'Fartlek pickups', detail: '6-8 x 60-90 sec comfortably-hard surges with easy jogging recovery between, embedded in an otherwise easy run.' },
  { name: 'Marathon-pace segment', detail: '(Week 10+) 2-3 miles at goal pace mid-run. From Week 10 on, alternate this with fartlek/progression. Skip all variety on step-back weeks (easy only).' }
];

const AUTOREGULATION_RULES = [
  { trigger: 'Recovery in the red 3+ consecutive days', action: 'Convert Wednesday’s quality segment to easy, or skip the Tuesday power session. Don’t skip the long run outright unless recovery stays red through Friday — then keep Saturday’s long run but drop any marathon-pace segment and run it fully easy.' },
  { trigger: 'HRV trending down for a week with rising resting HR', action: 'Leading indicator you’re outrunning recovery capacity. Hold mileage flat rather than progressing that week, even if it’s not a scheduled step-back week.' },
  { trigger: 'Any localized bone pain (shin, foot, femoral) that worsens with running', action: 'Stop. Do not run through it. Get it assessed.' },
  { trigger: 'Bar speed visibly slows for 2 consecutive reps (Trap Bar Deadlift / Power Clean)', action: 'Stop the set — this is the autoregulation signal, not the prescribed rep count.' },
  { trigger: 'Guardrail on long-run progression', action: 'If any week’s planned long run would be >15% longer than your most recent actual longest run (not the plan’s number — your real one), scale it back to a 10-15% increase instead and resume progression the following week. Never "make up" a missed long run by adding the missed distance onto the next one.' }
];

const MILESTONES = [
  { label: 'End of Week 9 (Sep 5)', target: '~9-mile long run, ~19-20 mi/week.' },
  { label: 'End of Week 13 (Oct 3)', target: '~11-mile long run (post step-back), ~30 mi/week peak reached the prior week.' },
  { label: 'Week 16 (Oct 24)', target: '18-mile long run with marathon-pace finish — dress rehearsal. If it goes well, sub-5 is very achievable. If it’s a struggle, plan a conservative first half on race day and treat sub-5 as a stretch goal.' }
];

const PROGRAM_META = {
  goal: 'Finish injury-free, sub-5:00 (11:26/mi pace or faster)',
  raceDayPacing: 'Run the first 10 miles 10-15 sec/mi slower than 11:15-11:20 goal pace. A slightly conservative start costs almost nothing if you feel good later, and is the single best thing you can do for a sub-5 finish.',
  peakLongRun: '18 miles (Week 16) — not 20. Marginal fitness gain from 20 miles isn’t worth the added recovery cost for a finish-focused goal.'
};

// The match: rounds, the clock, the bomb and the money. Phases run
// buy (12 s, weapons are bought, nobody can be hurt) -> live (100 s:
// eliminate the other team, or the attackers plant at Site K) -> planted
// (35 s fuse: defenders must defuse, attackers must guard) -> over (5 s of
// scoreboard, then the next round resets bodies but keeps guns and money).
// First to 7 rounds, at most 12 played. Economy is Counter-Strike-shaped:
// $800 to start, $3,250 for a round win, $1,400 for a loss, $800 to the
// planter, $300 a kill — enough that a lost pistol round still buys an SMG,
// and two good rounds buy the marksman rifle.
export const BUY_TIME = 12;
export const ROUND_TIME = 100;
export const BOMB_TIME = 35;
export const OVER_TIME = 5;
export const WIN_SCORE = 7;
export const MAX_ROUNDS = 12;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;

export function createRounds(hooks) {
  const state = {
    round: 1,
    phase: 'buy',
    phaseT: BUY_TIME,
    scoreAtk: 0,
    scoreDef: 0,
    money: 800,
    bombPlanted: false,
    bombPos: { x: 0, z: -20 },
    lastWinner: null,
    lastReason: '',
    matchWinner: null,
  };

  function endRound(winner, reason) {
    if (state.phase === 'over' || state.phase === 'matchover') return;
    state.lastWinner = winner;
    state.lastReason = reason;
    if (winner === 'atk') state.scoreAtk += 1; else state.scoreDef += 1;
    state.money = Math.min(16000, state.money + (winner === 'atk' ? 3250 : 1400));
    state.phase = 'over';
    state.phaseT = OVER_TIME;
    hooks.onRoundEnd(winner, reason);
  }

  function beginRound() {
    state.bombPlanted = false;
    state.phase = 'buy';
    state.phaseT = BUY_TIME;
    hooks.onBeginRound(state.round);
  }

  return {
    state,
    startMatch() {
      state.round = 1;
      state.scoreAtk = 0;
      state.scoreDef = 0;
      state.money = 800;
      state.matchWinner = null;
      beginRound();
    },
    plantBomb(x, z) {
      if (state.phase !== 'live') return;
      state.bombPlanted = true;
      state.bombPos = { x, z };
      state.phase = 'planted';
      state.phaseT = BOMB_TIME;
      hooks.onPlanted(x, z);
    },
    defuseBomb() {
      if (state.phase !== 'planted') return;
      endRound('def', 'defused');
    },
    explodeBomb() {
      hooks.onExploded(state.bombPos.x, state.bombPos.z);
      endRound('atk', 'detonation');
    },
    addMoney(n) { state.money = Math.min(16000, state.money + n); },
    spend(n) {
      if (state.money < n) return false;
      state.money -= n;
      return true;
    },
    timeLeft() { return Math.max(0, state.phaseT); },
    update(dt, counts) {
      if (state.phase === 'matchover') return;
      state.phaseT -= dt;
      if (state.phase === 'buy') {
        if (state.phaseT <= 0) {
          state.phase = 'live';
          state.phaseT = ROUND_TIME;
          hooks.onLive();
        }
        return;
      }
      if (state.phase === 'live') {
        if (counts.defAlive === 0) endRound('atk', 'elimination');
        else if (counts.atkAlive === 0) endRound('def', 'elimination');
        else if (state.phaseT <= 0) endRound('def', 'time expired');
        return;
      }
      if (state.phase === 'planted') {
        if (counts.defAlive === 0) endRound('atk', 'elimination');
        else if (state.phaseT <= 0) {
          hooks.onExploded(state.bombPos.x, state.bombPos.z);
          endRound('atk', 'detonation');
        }
        return;
      }
      if (state.phase === 'over') {
        if (state.phaseT <= 0) {
          if (state.scoreAtk >= WIN_SCORE || state.scoreDef >= WIN_SCORE || state.round >= MAX_ROUNDS) {
            state.phase = 'matchover';
            state.matchWinner = state.scoreAtk > state.scoreDef ? 'atk' : 'def';
            hooks.onMatchEnd(state.matchWinner);
          } else {
            state.round += 1;
            beginRound();
          }
        }
      }
    },
  };
}

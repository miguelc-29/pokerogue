import Overrides from "#app/overrides";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import type { CommandPhase } from "#phases/command-phase";
import { GameManager } from "#test/framework/game-manager";
import type { ModifierSelectUiHandler } from "#ui/handlers/modifier-select-ui-handler";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Battle Rewards - Fleeing and Force Outs", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override.moveset([MoveId.SPLASH, MoveId.ROAR]).startingLevel(100).enemyLevel(10).criticalHits(false);
  });

  /**
   * Intercepts the end of the battle and advances to the modifier selection phase.
   * Fails early if the game attempts to bypass the shop screen when it shouldn't.
   */
  async function getModifierShopHandler(): Promise<ModifierSelectUiHandler> {
    await game.phaseInterceptor.to("BattleEndPhase");
    await vi.waitUntil(() => !game.scene.phaseManager.getCurrentPhase()?.is("BattleEndPhase"));

    const currentPhase = game.scene.phaseManager.getCurrentPhase()?.phaseName;
    expect(currentPhase, "Expected battle to transition to SelectModifierPhase").toBe("SelectModifierPhase");

    await game.phaseInterceptor.to("SelectModifierPhase");
    await vi.waitUntil(() => game.scene.ui.getMode() === UiMode.MODIFIER_SELECT);

    return game.scene.ui.getHandler() as ModifierSelectUiHandler;
  }

  describe("single wild encounters", () => {
    it("should offer no rewards on enemy-initiated flee (Teleport)", async () => {
      game.override.enemySpecies(SpeciesId.ABRA).enemyMoveset([MoveId.TELEPORT]).battleStyle("single");
      await game.classicMode.startBattle(SpeciesId.ABRA);

      game.move.select(MoveId.SPLASH);
      await game.move.selectEnemyMove(MoveId.TELEPORT);

      const handler = await getModifierShopHandler();
      expect(handler.options.length).toBe(0);
    });

    it("should offer no rewards on player-initiated force out (Roar)", async () => {
      game.override.enemySpecies(SpeciesId.MAGIKARP).enemyMoveset([MoveId.SPLASH]).battleStyle("single");
      await game.classicMode.startBattle(SpeciesId.MAGIKARP);

      game.move.select(MoveId.ROAR);

      const handler = await getModifierShopHandler();
      expect(handler.options.length).toBe(0);
    });
  });

  describe("player run escape", () => {
    it("should completely bypass the modifier select phase on a standard run away", async () => {
      game.override.enemySpecies(SpeciesId.MAGIKARP).enemyMoveset([MoveId.SPLASH]).battleStyle("single");
      await game.classicMode.startBattle(SpeciesId.MAGIKARP);

      vi.spyOn(Overrides, "RUN_SUCCESS_OVERRIDE", "get").mockReturnValue(true);

      const commandPhase = game.scene.phaseManager.getCurrentPhase() as CommandPhase;
      commandPhase.handleCommand(Command.RUN, 0);

      await game.toNextWave();

      expect(game.scene.currentBattle.waveIndex).toBe(2);
      expect(game.scene.ui.getMode()).not.toBe(UiMode.MODIFIER_SELECT);
    });
  });

  describe("double wild encounters", () => {
    it("should offer no rewards when both opponents flee and zero are defeated", async () => {
      game.override.battleStyle("double").enemySpecies(SpeciesId.MAGIKARP).enemyMoveset([MoveId.SPLASH]);
      await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.MAGIKARP);

      const [p1, p2] = game.scene.getPlayerParty();
      game.move.changeMoveset(p1, [MoveId.ROAR]);
      game.move.changeMoveset(p2, [MoveId.SPLASH]);

      game.move.select(MoveId.ROAR, 0, 2);
      game.move.select(MoveId.SPLASH, 1);
      await game.toNextTurn();

      game.move.select(MoveId.ROAR, 0, 3);
      game.move.select(MoveId.SPLASH, 1);

      const handler = await getModifierShopHandler();
      expect(handler.options.length).toBe(0);
    });

    it("should offer partial rewards when one opponent is defeated and the other flees", async () => {
      game.override.battleStyle("double");
      await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.MAGIKARP);

      const [p1, p2] = game.scene.getPlayerParty();
      game.move.changeMoveset(p1, [MoveId.THUNDERBOLT, MoveId.ROAR]);
      game.move.changeMoveset(p2, [MoveId.SPLASH]);

      game.move.select(MoveId.THUNDERBOLT, 0, 2);
      game.move.select(MoveId.SPLASH, 1);
      await game.toNextTurn();

      game.move.select(MoveId.ROAR, 0, 3);
      game.move.select(MoveId.SPLASH, 1);

      const handler = await getModifierShopHandler();
      expect(handler.options.length).toBe(3);
    });
  });

  describe("emergency exit edge cases", () => {
    beforeEach(() => {
      game.override.enemyAbility(AbilityId.EMERGENCY_EXIT);
    });

    it("should offer no rewards when triggered in a single battle", async () => {
      game.override.startingWave(2).battleStyle("single").enemySpecies(SpeciesId.GOLISOPOD);
      await game.classicMode.startBattle(SpeciesId.GOLISOPOD);

      const player = game.scene.getPlayerParty()[0];
      game.move.changeMoveset(player, [MoveId.FALSE_SWIPE]);

      game.move.select(MoveId.FALSE_SWIPE);

      const handler = await getModifierShopHandler();
      expect(handler.options.length).toBe(0);
    });

    it("should offer partial rewards in a double battle when one opponent is defeated and the other triggers Emergency Exit", async () => {
      game.override.startingWave(2).battleStyle("double");
      await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.GOLISOPOD);

      const [p1, p2] = game.scene.getPlayerParty();
      game.move.changeMoveset(p1, [MoveId.THUNDERBOLT, MoveId.FALSE_SWIPE]);
      game.move.changeMoveset(p2, [MoveId.SPLASH]);

      game.move.select(MoveId.THUNDERBOLT, 0, 2);
      game.move.select(MoveId.SPLASH, 1);
      await game.toNextTurn();

      game.move.select(MoveId.FALSE_SWIPE, 0, 3);
      game.move.select(MoveId.SPLASH, 1);

      const handler = await getModifierShopHandler();
      expect(handler.options.length).toBe(3);
    });

    it("should offer no rewards in a double battle when one opponent is forced out and the other triggers Emergency Exit", async () => {
      game.override.startingWave(2).battleStyle("double");
      await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.GOLISOPOD);

      const [p1, p2] = game.scene.getPlayerParty();
      game.move.changeMoveset(p1, [MoveId.ROAR, MoveId.FALSE_SWIPE]);
      game.move.changeMoveset(p2, [MoveId.SPLASH]);

      game.move.select(MoveId.ROAR, 0, 2);
      game.move.select(MoveId.SPLASH, 1);
      await game.toNextTurn();

      game.move.select(MoveId.FALSE_SWIPE, 0, 3);
      game.move.select(MoveId.SPLASH, 1);

      const handler = await getModifierShopHandler();
      expect(handler.options.length).toBe(0);
    });
  });

  describe("trainer battle edge cases", () => {
    it("should bypass rewards and fail to end battle when roar is used in trainer battles", async () => {
      game.override
        .battleStyle("single")
        .battleType(BattleType.TRAINER)
        .randomTrainer({ trainerType: TrainerType.YOUNGSTER })
        .enemySpecies(SpeciesId.RATTATA)
        .enemyMoveset([MoveId.SPLASH]);

      await game.classicMode.startBattle(SpeciesId.RATTATA, SpeciesId.PIDGEY);

      const enemyIdBefore = game.field.getEnemyPokemon().id;

      game.move.select(MoveId.ROAR);
      await game.toNextTurn();

      const enemyIdAfter = game.field.getEnemyPokemon().id;

      expect(enemyIdAfter).not.toBe(enemyIdBefore);
      expect(game.scene.ui.getMode()).not.toBe(UiMode.MODIFIER_SELECT);
      expect(game.field.getEnemyPokemon().isFainted()).toBe(false);
    });
  });
});

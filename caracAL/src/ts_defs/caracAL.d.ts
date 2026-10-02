/*
Credit to @thmsn
You rock!
*/

export {};
declare global {
  interface CaracALEmergencyStopState {
    active: boolean;
    reason: string | null;
    activated_at: number | null;
    cleared_at: number | null;
    revision: number;
  }

  interface CaracALRuntimeEvent {
    version: 1;
    id: string;
    timestamp: number;
    module: string;
    type: string;
    why?: string;
    correlationId?: string;
    actionId?: string;
    data?: Record<string, unknown>;
  }

  /** When you access parent via game code, this is what you have access to. */
  interface Window {
    /**
     * Contains an object if we are running the character in caracAL
     * https://github.com/numbereself/caracAL
     */
    caracAL?: {
      /**
       *
       * @param characterName
       * @param serverRealm
       * @param scriptPath
       * @param gameVersion
       * @example <caption>runs other char with script farm_snakes.js in current realm</caption>
       * parent.caracAL.deploy(another_char_name,null,"farm_snakes.js");
       * @example <caption>runs current char with current script in US 2</caption>
       * parent.caracAL.deploy(null,"USII");
       */
      deploy(
        characterName: string | null | undefined,
        serverRealm: string | null | undefined,
        scriptPath: string | null | undefined,
        gameVersion?: string | number | null,
      ): void;

      /**
       * Shuts down a character. Omitting the name shuts down the current one.
       */
      shutdown(characterName?: string | null): void;

      /**
       * Desired runtime state assigned by the local headless supervisor.
       * Cooperative bot code must not start new work while PAUSED.
       */
      runtime_state: "RUNNING" | "PAUSED" | "STOPPED";

      /**
       * Global account mutation safety stop controlled by the local supervisor.
       */
      emergency_stop: boolean;
      emergency_stop_state: CaracALEmergencyStopState;

      /**
       * Sends one bounded structured runtime event to the local supervisor.
       * Returns false when the event is invalid or IPC is unavailable.
       */
      emit_event(event: CaracALRuntimeEvent): boolean;

      /**
       * All the characters running in our current caracAL instance
       */
      siblings: string[];

      /**
       * load one or more additional scripts
       * @param scripts
       * @example <caption>get a promise for loading the script ./CODE/bonus_script.js</caption>
       * parent.caracAL.load_scripts(["bonus_script.js"])
       * .then(()=>console.log("the new script is loaded"));
       */
      load_scripts(scripts: string[]): Promise<void>;
    };
  }
}

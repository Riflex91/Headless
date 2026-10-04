//DO NOT SHARE THIS WITH ANYONE
//the session key can be used to take over your account
//and I would know.(<3 u Nex)
module.exports = {
  //to obtain a session: show_json(parent.user_id+"-"+parent.user_auth)
  //or just delete the config file and restart caracAL
  session: "1111111111111111-abc123ABCabc123ABCabc",
  //delete all versions except the two latest ones
  cull_versions: true,
  //If you want caracAL to compile TypeScript and use the TYPECODE folder
  //This works by running Webpack in the background
  enable_TYPECODE: true,
  //how much logging you want
  //set to "debug" for more logging and "warn" for less logging
  log_level: "info",
  full_autonomy: {
    //explicit opt-in; keep false until Phase 18 execution is intentionally enabled
    enabled: false,
    //at most one lifecycle mutation is dispatched per reconciliation cycle
    reconcile_interval_ms: 5000,
  },
  lifecycle: {
    //hard cap for this bot; never start more than four character processes
    max_online_characters: 4,
    //delay between initial character starts to avoid connection bursts
    startup_stagger_ms: 1500,
    //unexpected exits use exponential backoff from this delay
    restart_base_ms: 2000,
    //maximum unexpected-exit restart delay
    restart_max_ms: 60000,
    //after this much stable runtime the crash backoff is reset
    restart_reset_ms: 60000,
    //child process heartbeat cadence and stale-process watchdog
    heartbeat_interval_ms: 5000,
    heartbeat_timeout_ms: 20000,
    watchdog_interval_ms: 5000,
  },
  //where to log to
  //the lines are commands which use stdin stream and write it somwehere
  //default is a logrotate file and colorful stdout formatting
  //advanced linuxers: keep in mind that file redirects (>) and pipes (|) are a shell feature
  //so if you wanna use them you have to prefix your command with "bash", "-c"
  log_sinks: [
    [
      "node",
      "./node_modules/logrotate-stream/bin/logrotate-stream",
      "./logs/caracAL.log.jsonl",
      "--keep",
      "3",
      "--size",
      "4500000",
    ],
    ["node", "./standalones/LogPrinter.js"],
  ],
  web_app: {
    //enables the new local headless control center at /headless
    enable_headless_dashboard: true,
    //enables the legacy monitoring dashboard
    enable_bwi: false,
    //enables the minimap in dashboard
    //setting this to true implicitly
    //enables the dashboard
    enable_minimap: false,
    //exposes the CODE directory via http
    //this lets you load and debug outside of caracAL
    expose_CODE: false,
    //exposes the TYPECODE.out directory via http
    //this lets you load and debug outside of caracAL
    //useful if you want to dev in regular client
    expose_TYPECODE: false,
    //which port to run webservices on
    port: 924,
  },
  characters: {
    Wizard: {
      realm: "EUPVP",
      script: "caracAL/examples/crabs.js",
      enabled: true,
      version: 0,
    },
    MERC: {
      realm: "USIII",
      script: "caracAL/tests/deploy_test.js",
      enabled: true,
      version: "halflife3",
    },
    GG: {
      realm: "ASIAI",
      typescript: "caracAL/examples/crabs_with_tophats.js",
      enabled: false,
      version: 0,
    },
  },
};

# Block Battalion UI

The user interaface for the block battalion game. The UI uses the [etf.js](https://github.com/ideal-lab5/etf.js) library for interacting with the contract (deployed to the ETF network) as well as for performing timelock encryption and decryption. 

## Deploying contracts

``` sh
cargo contract upload clock/mine-clock/target/ink/mine_event_clock.wasm --suri //Alice --url ws://127.0.0.1:9944 -x
# then get the output and plug it in here
cargo contract instantiate ./target/ink/block_defender.wasm --constructor new --args 25 25 100 0x6cca45f120c762ee69d9f20fb11cec032553af29955417013ebeaca5bb3cadd0 10000000 --suri //Alice --url ws://127.0.0.1:9944 -x
```

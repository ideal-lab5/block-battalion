import { useContext, useEffect, useReducer, useRef, useState } from 'react';
import './game-screen.component.css';
import { web3FromAddress } from "@polkadot/extension-dapp";
import { CodePromise, ContractPromise } from '@polkadot/api-contract';
import { BN, BN_ONE, compactStripLength, isHex } from "@polkadot/util";
import { sha256AsU8a, cryptoWaitReady } from '@polkadot/util-crypto';


import abi from '../../resources/contract_data/block_battalion.json';
import contractFile from '../../resources/contract_data/block_battalion.contract.json';
import { EtfContext } from '../../EtfContext';
import InputMask from "react-input-mask";
import Modal from '../common/modal';

function GameScreen() {

  const MAX_CALL_WEIGHT = new BN(1_000_000_000_000).isub(BN_ONE);
  const PROOFSIZE = new BN(1_000_000_000);

  const [address, setAddress] = useState('');
  const [showLoadGame, setShowLoadGame] = useState(false);
  const [gameContract, setGameContract] = useState('');
  const [gameContractAddress, setGameContractAddress] = useState('');
  const [clockInitialized, setClockInitialized] = useState(false);
  const [showBitRoulette, setShowBitRoulette] = useState(false);

  const [upcomingMineEventSlot, setUpcomingMineEventSlot] = useState(0);

  const [playerResources, setPlayerResources] = useState([]);

  const [loading, setLoading] = useState(false);

  const [players, setPlayers] = useState([]);
  const [playerBases, setPlayerBases] = useState([]);

  const [mineInput, setMineInput] = useState(0);
  const [selectedCell, setSelectedCell] = useState(null);
  const [playerColors, setPlayerColors] = useState([]);

  const [eventInterval, setEventInterval] = useState(0);
  const [eventStartSlot, setEventStartSlot] = useState(0);

  const { etf, signer, latestSlot } = useContext(EtfContext);

  const gridContainerRef = useRef(null);

  const playerBaseStyle = (color) => ({
    background: `#${color}`
  });

  const playerNameStyle = (color) => ({
    color: `#${color}`
  });

  const isMineInput = (num) => ({
    backgroundColor: num === mineInput ? '#333' : 'black'
  });

  useEffect(() => {
      const setup = async () => {
        // etf.eventEmitter.on('blockHeader', async () => {
          if (gameContract) {
            await getNextMineSlot(gameContract);
            let players = await loadPlayers(gameContract);
            await loadPlayerBases(gameContract, players);
            await getPlayerResources(gameContract);
            await getClockInitialized(gameContract);
            // forceUpdate();
          }
      }
      setup();
  }, [latestSlot]);

  async function deployNewGame() {
    setLoading(true);
    const contractWasm = contractFile.source.wasm;
    const contract = new CodePromise(etf.api, abi, contractWasm);
    console.log("contract is :", contract);
    const injector = await web3FromAddress(signer.address);
    // get the current slot and add 20 (10 slots from now)
    let startSlot = parseInt(latestSlot.slot.replaceAll(",", ""));

    const tx = contract.tx.new({
      gasLimit: etf.api.registry.createType('WeightV2', {
        refTime: MAX_CALL_WEIGHT,
        proofSize: PROOFSIZE,
      }),
      storageDepositLimit: null,
    }, 25, 25, 10);
    let address = "";
    const unsub = await tx.signAndSend(
      signer.address,
      { signer: injector.signer },
      async ({contract, status}) => {
        if (status.isInBlock) {
          address = contract.address.toString();
          setGameContract(contract);
          localStorage.setItem("gameContractAddress", address);
          setGameContractAddress(address);
          setLoading(false);
          unsub();
        }
      }
    );
  };

  async function initEventClock(contract) {
    setLoading(true);
    
    const injector = await web3FromAddress(signer.address);

    // get the current slot and add 20 (10 slots from now)
    // let startSlot = parseInt(latestSlot.slot.replaceAll(",", ""));

    const tx = contract.tx.initializeEventClock({
      gasLimit: etf.api.registry.createType('WeightV2', {
        refTime: MAX_CALL_WEIGHT,
        proofSize: PROOFSIZE,
      }),
      storageDepositLimit: null,
    }, 
    "Mine", 
    "0x56a4f7cc2f98307df62d602933fe9aba7bd274c62b437fcaf8e69c138dbe7e01",
    {
      initial_slot: eventStartSlot,
      interval: eventInterval,
    });
    const unsub = await tx.signAndSend(
      signer.address,
      { signer: injector.signer },
      async result => {
        if (result.status.isInBlock) {
          setClockInitialized(true);
          await getNextMineSlot(contract);
          let players = await loadPlayers(contract);
          await loadPlayerBases(contract, players);
          await getPlayerResources(contract);
          setLoading(false);
          unsub();
        }
      }
    );
  }

  async function loadGame() {
    setShowLoadGame(false);
    setLoading(true);
    let contract = await new ContractPromise(etf.api, abi, address);
    await getNextMineSlot(contract);
    localStorage.setItem('gameContractAddress', address);
    setGameContract(contract);
    setGameContractAddress(address);
    let players = await loadPlayers(contract);
    await loadPlayerBases(contract, players);
    await getPlayerResources(contract);
    // TODO: the clock may not be initialized, perhaps we need to add a new query to check
    // setClockInitialized(true);
    setLoading(false);
  }

  async function continueGame() {
    setLoading(true);
    let gameContractAddress = localStorage.getItem('gameContractAddress');
    let contract = await new ContractPromise(etf.api, abi, gameContractAddress);
    await getNextMineSlot(contract);
    setGameContract(contract);
    setGameContractAddress(gameContractAddress);
    let players = await loadPlayers(contract);
    await loadPlayerBases(contract, players);
    await getPlayerResources(contract);
    // TODO: the clock may not be initialized, perhaps we need to add a new query to check
    // setClockInitialized(true);
    setLoading(false);
  }

  async function getNextMineSlot(contract) {
    await cryptoWaitReady();
    let nextMineSlot = await getNextSlot(contract, "Mine");
    if (nextMineSlot) {
      let formatted = parseInt(nextMineSlot.replaceAll(",", ""));
      console.log('next mine slot');
      console.log(formatted)
      setUpcomingMineEventSlot(formatted);
    }
  }

  // initializes the player struct in the contract (if it doesn't exist)
  async function initPlayer(x, y) {
    setLoading(true);
    const injector = await web3FromAddress(signer.address);
    await gameContract.tx
      .initPlayer({
        gasLimit: etf.api.registry.createType('WeightV2', {
          refTime: MAX_CALL_WEIGHT,
          proofSize: PROOFSIZE,
        }),
        storageDepositLimit: null,
      },
        x, y
      ).signAndSend(signer.address, { signer: injector.signer }, async result => {
        // Log the transaction status
        console.log('Transaction status:', result.status.type);
        if (result.status.isInBlock) {
          let players = await loadPlayers(gameContract);
          await loadPlayerBases(gameContract, players);
          // let newColor = {};
          // newColor[signer.address] = 'eeff34';
          // if (playerColors ===  || playerColors[0][signer.address] === undefined) {
          //   setPlayerColors(newColor);
          // }
          console.log(`Transaction included in block hash ${result.status.asInBlock}`);
          setLoading(false);
        }
      });
  }

  async function loadPlayers(contract) {
    const { output } = await contract.query.getPlayers(
      signer.address,
      {
        gasLimit: etf.api.registry.createType('WeightV2', {
          refTime: MAX_CALL_WEIGHT,
          proofSize: PROOFSIZE,
        }),
        storageDepositLimit: null,
      },
    );


    let players = output === null ? [] : output.toHuman().Ok;
    console.log('hey');
    console.log(players);
    let playerColorMap = playerColors;
    players.forEach((player, idx) => {
      console.log('existing')
      console.log(playerColorMap[player])
      if (playerColorMap[player] === undefined) {
        let randomHex = generateRandomColor();
        playerColorMap[player] = randomHex;
        // const isHexColor = randomMaybeHex => typeof hex === 'string' 
        //   && randomMaybeHex.length === 6
        //   && !isNaN(Number('0x' + randomMaybeHex))
        // if (isHexColor(randomMaybeHex)) {
        //   playerColorMap[player] = randomMaybeHex;
        // } else {
        //   // only giving two chances because I'm lazy
        //   randomMaybeHex = generateRandomColor();
        //   playerColorMap[player] = randomMaybeHex;
        // }
      }
    });

    // TODO: we can also prune the map if players are removed
    setPlayerColors(playerColorMap);
    setPlayers(players);
    return players;
  }

  async function loadPlayerBases(contract) {
    // let con = contract === null ? gameContract : contract
    // console.log(con === null);
    const { output } = await contract.query.getPlayerBase(
      signer.address,
      {
        gasLimit: etf.api.registry.createType('WeightV2', {
          refTime: MAX_CALL_WEIGHT,
          proofSize: PROOFSIZE,
        }),
        storageDepositLimit: null,
      },
    );

    let results = output.toHuman().Ok;

    // now I want to flatmap the core and all child points
    let playerBases = {};
    for (let res of results) {
      // console.log(results[0][1]);
      let core = {
        power: res[1]['power'],
        x: res[1]['x'],
        y: res[1]['y']
      };
      let children = res[1]['children'].map(child => {
        return {
          power: child['power'],
          x: child['x'],
          y: child['y'],
        };
      });
      
      // Add the core to the playerBases dictionary
      playerBases[`${core.x},${core.y}`] = { owner: res[0], type: 'core', data: core };

      // Add the children to the playerBases dictionary
      for (let child of children) {
        playerBases[`${child.x},${child.y}`] = { owner: res[0], type: 'child', data: child };
      }

    }
    console.log('bases')
    console.log(playerBases);
    setPlayerBases(playerBases);
  }

  async function getClockInitialized(gameContract) {
    const { output } = await gameContract.query.getResourceEventAddress(
      signer.address,
      {
        gasLimit: etf.api.registry.createType('WeightV2', {
          refTime: MAX_CALL_WEIGHT,
          proofSize: PROOFSIZE,
        }),
        storageDepositLimit: null,
      },
    );
    setClockInitialized(output.toHuman().Ok !== null);
  }

  async function getNextSlot(gameContract, action) {
    const { output } = await gameContract.query.getNextSlot(
      signer.address,
      {
        gasLimit: etf.api.registry.createType('WeightV2', {
          refTime: MAX_CALL_WEIGHT,
          proofSize: PROOFSIZE,
        }),
        storageDepositLimit: null,
      }, action
    );
    return output === null ? '' : output.toHuman().Ok;
  }

  async function getPlayerResources(gameContract) {
    const { output } = await gameContract.query.getPlayerResources(
      signer.address,
      {
        gasLimit: etf.api.registry.createType('WeightV2', {
          refTime: MAX_CALL_WEIGHT,
          proofSize: PROOFSIZE,
        }),
        storageDepositLimit: null,
      }, signer.address,
    );
    if (output !== null) {
      setPlayerResources(output.toHuman().Ok);
    }
  }

  async function execMineClock(b) {
    // prepare a timelocked value and commitment
    // then call the the game contract, which proxies it to the mine event clock

    // timelock encryption
    // for this, we first need to get the correct slot number to encrypt to
    // todo: use sha3 hasher to seed the encrypt call
    let seed = new Date();
    let out = etf.encrypt(b.toString(), 1, [upcomingMineEventSlot], seed);
    // console.log(etf_ct);
    // console.log('capsule');
    // console.log(out.ct.etf_ct[0])

    let commitment = sha256AsU8a(sha256AsU8a(b) + sha256AsU8a(out.ct.key));
    // for now, we will store the msk and nonce in localstorage
    localStorage.setItem(upcomingMineEventSlot, JSON.stringify(
      {
        key: out.ct.key,
        nonce: out.ct.nonce
      }));
    let message = {
      ciphertext: out.ct.aes_ct.ciphertext,
      nonce: out.ct.aes_ct.nonce,
      capsule: out.ct.etf_ct[0],
      commitment: Array.from(commitment),
    };

    // then make the contract call
    const injector = await web3FromAddress(signer.address);
    await gameContract.tx
      .play({
        gasLimit: etf.api.registry.createType('WeightV2', {
          refTime: MAX_CALL_WEIGHT,
          proofSize: PROOFSIZE,
        }),
        storageDepositLimit: null,
      }, "Mine", message
      ).signAndSend(signer.address, { signer: injector.signer }, async result => {
        // Log the transaction status
        console.log('Transaction status:', result.status.type);
        if (result.status.isInBlock) {
          console.log(`Transaction included in block hash ${result.status.asInBlock}`);
          setShowBitRoulette(false);
        }
      });
  }

  async function loadNextRoundInput(contract, action) {
    const { output } = await contract.query.getNextRoundInput(
      signer.address,
      {
        gasLimit: etf.api.registry.createType('WeightV2', {
          refTime: MAX_CALL_WEIGHT,
          proofSize: PROOFSIZE,
        }),
        storageDepositLimit: null,
      }, action
    );

    return output.toHuman().Ok === null ? [] : output.toHuman().Ok;
  }

  async function execAdvanceMineClock() {
    // 1. fetch all ciphertexts from the contract storage
    let nextRoundInput = await loadNextRoundInput(gameContract, "Mine");
    // 2. decrypt all ciphertexts and build Vec<(AccountId, u8, [u8;32])>
    let inputs = [];
    for (let input of nextRoundInput) {
      let player = input[0];
      // let msg = input[1];
      
      let msg = etf.createType('TlockMessage', input[1]);
      let b = await etf.decrypt(
        msg.ciphertext,
        msg.nonce,
        [msg.capsule], // expects Vec<Vec<u8>>
        [upcomingMineEventSlot],
      );
      let bit = parseInt(String.fromCharCode(...b));
      let decrypted = {
        address: player, 
        data: bit, 
        msk: [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1] // TODO
      };
      console.log(decrypted);
      inputs.push(decrypted);
    };

    const injector = await web3FromAddress(signer.address);
    await gameContract.tx
      .advanceClock({
        gasLimit: etf.api.registry.createType('WeightV2', {
          refTime: MAX_CALL_WEIGHT,
          proofSize: PROOFSIZE,
        }),
        storageDepositLimit: null,
      }, "Mine", inputs
      ).signAndSend(signer.address, { signer: injector.signer }, async result => {
        // Log the transaction status
        console.log('Transaction status:', result.status.type);
        if (result.status.isInBlock) {
          await getNextMineSlot(gameContract);
          let players = await loadPlayers(gameContract);
          await loadPlayerBases(gameContract, players);
          await getPlayerResources(gameContract);
          console.log(`Transaction included in block hash ${result.status.asInBlock}`);
        }
      });
  }

  async function execExpandBase(amount) {
    const injector = await web3FromAddress(signer.address);
    await gameContract.tx
      .expandBase({
        gasLimit: etf.api.registry.createType('WeightV2', {
          refTime: MAX_CALL_WEIGHT,
          proofSize: PROOFSIZE,
        }),
        storageDepositLimit: null,
      }, selectedCell['x'], selectedCell['y'],
      ).signAndSend(signer.address, { signer: injector.signer }, async result => {
        // Log the transaction status
        console.log('Transaction status:', result.status.type);
        if (result.status.isInBlock) {
          let players = await loadPlayers(gameContract);
          loadPlayerBases(gameContract, players);
          await getPlayerResources(gameContract);
          console.log(`Transaction included in block hash ${result.status.asInBlock}`);
        }
      });
  }

  function handleSetEventStartSlot(value) {
    // it should be a valid slot number
    // basically we just need to make sure it is *some* valid number
    // strip any special characters
    setEventStartSlot(value);
  }

  function handlePlayerNameClick(player) {
    const playerBase = Object.values(playerBases).find(
      (base) => base.owner === player
    );

    if (playerBase) {
      if (gridContainerRef !== undefined) {
        const x = playerBase.data.x;
        const y = playerBase.data.y;
        const index = mapCoordinatesToIndex(parseInt(x), parseInt(y));
        const cellSize = 20;
        const scrollLeft = (index % 25) * cellSize;
        const scrollTop = Math.floor(index / 25) * cellSize;
        gridContainerRef.current.scrollTo({
          left: scrollLeft,
          top: scrollTop,
          behavior: 'smooth',
        });
      }
    }
  };

  function generateRandomColor() {
    return Math.floor(Math.random()*16777215).toString(16);
  }

  const mapCoordinatesToIndex = (x, y) => x + y * 25;

  const truncateAddress = (input) => {
    return input === undefined ? '' : 
      input.substring(0, 4) + '...' + input.substring(input.length - 4);
  }

  const BitRouletteModal = () => {
    return <div className="event-config">
      <Modal
          title="Search for a resource"
          visible={showBitRoulette}
          onClose={() => setShowBitRoulette(false)}
      >
        <div className='resource-selector'>
          <div style={ isMineInput(0) } className='zero resource' onClick={() => setMineInput(0)}>
            0
          </div>
          <div style={ isMineInput(1 )} className='one resource' onClick={() => setMineInput(1)}>
            1
          </div>
        </div>
        <button className='start-btn btn' 
          onClick={() => execMineClock(mineInput)}>
        Submit
      </button>
      </Modal>
    </div>
  }

  return (
    <div className="game-screen">

    {loading === true ? 
      <div>
          Loading...
      </div> :
    <div className=''>
      {gameContract === '' ?
        <div className='load-game-container'>
          {showLoadGame === true ?
            <div className='event-config'>
              <input type="text" placeholder='5ghAd8...'
                value={address} onChange={(e) => setAddress(e.target.value)} />
              <button className='start-btn menu-btn' onClick={loadGame}>
                Submit
              </button>
              <button className='start-btn menu-btn' onClick={() => setShowLoadGame(false)}>
                Back
              </button>
            </div> :
            <div>
              <button className='start-btn menu-btn' onClick={deployNewGame}>
                New Game
              </button>
              <button className='start-btn menu-btn' onClick={() => setShowLoadGame(true)}>
                Search Games
              </button>
              <button className='start-btn menu-btn' onClick={continueGame}>
                Continue Game
              </button>
            </div>
          }

        </div> :
        <div>
            <div className='game-details-container'>
              <div className='player-details'>
                  <span 
                    className='clickable' 
                    onClick={
                      () => 
                        navigator.clipboard.writeText(gameContractAddress)
                    }>
                    Game Address: { gameContractAddress.substring(0, 4) + '...' + gameContractAddress.substring(gameContractAddress.length - 4) }
                  </span>
                  {
                    players.indexOf(signer.address) < 0 && clockInitialized ?
                    <button className='start-btn btn' onClick={() => initPlayer(
                      Math.floor(Math.random() * 25),
                      Math.floor(Math.random() * 25))
                    }>
                      Create Base
                    </button>
                    : <div></div>}
                  {clockInitialized && upcomingMineEventSlot > 0 && latestSlot && parseInt(latestSlot.slot.replaceAll(",", "")) > upcomingMineEventSlot ?
                    <button className='start-btn btn' onClick={() => execAdvanceMineClock()}>
                      Harvest ({ upcomingMineEventSlot })
                    </button> :
                    <div>
                      { upcomingMineEventSlot ? 
                      <div className='actions-container'>
                        <button className='start-btn btn' onClick={() => setShowBitRoulette(true)}>
                          Farm ({!latestSlot ? '' : parseInt(upcomingMineEventSlot - latestSlot.slot.replaceAll(",", ""))})
                        </button>
                        <span>Resources: { playerResources === null ? 0 : playerResources }</span>
                      </div> :
                      <div className='event-config'>
                        <div className="input-container">
                          <label htmlFor='interval-config'>Resource event interval:</label>
                          <input
                            id='interval-config' 
                            value={eventInterval} 
                            type="number" 
                            placeholder='100' 
                            onChange={(e) => setEventInterval(e.target.value)}
                          />
                        </div>
                        <div className="input-container">
                          <label htmlFor='start-slot-config'>
                            Event start slot:
                          </label>
                          <InputMask 
                            mask="999999999" 
                            placeholder={latestSlot.slot.replaceAll(",", "")}
                            onChange={(e) => handleSetEventStartSlot(e.target.value)} 
                            // value={eventStartSlot}
                          />
                        </div>
                        <button className='start-btn btn' onClick={() => initEventClock(gameContract)}>
                          Start Game
                        </button>
                      </div>
                      }
                    </div>
                  }
                <div>
                  { selectedCell ? 
                    <div className='cell-details'>
                      <span>Coordinate: ({ selectedCell['x'] }, { selectedCell['y']})</span>
                      { selectedCell["base"] === undefined ? 
                      <div className='player-details'>
                        <span>Unoccupied</span>
                        <button className='start-btn btn' onClick={() => execExpandBase(1)}>
                          Conquer
                        </button>
                      </div> :
                      <div className='player-details'>
                        <span>Owner: { truncateAddress(selectedCell["base"][0]) }</span>
                        <span>power: {selectedCell["base"]['data']["power"]}</span>
                        { selectedCell["base"][0] === signer.address ? 
                          <div>
                            { playerResources === null || playerResources === 0 ? '' :
                            <button className='start-btn btn'>
                              Upgrade
                            </button>
                            }
                          </div>: 
                          <div></div> }
                      </div> }
                    </div> : 
                    <div></div> }
                </div>
              </div>
              {/* the game board  */}
              { clockInitialized ?
              <div className='game-container flex-child' ref={gridContainerRef}>
                <div className="game-board">
                    {[...Array(25 * 25).keys()].map((key) => {
                      const x = key % 25;
                      const y = Math.floor(key / 25);
                      const baseKey = `${x},${y}`;
                      const base = playerBases[baseKey];
                      let color;
              

                      if (base !== undefined) {
                        if (playerColors) {
                          color = playerColors[base.owner];
                          console.log(color);
                        }
                      }
              
                      return (
                        <div
                          key={key}
                          style={ playerBaseStyle(color) }
                          className={`box ${base ? 'player-base' : ''}`}
                          onClick={() => {
                            setSelectedCell({ x, y, base })
                          }}
                        > { base !== undefined ? base.power : '' } </div>
                      );
                    })}
                </div>
              </div>
              : 
              <div>
                { gameContract && loading === true ? <div><span>Waiting for event clock initialization</span></div> : <div></div>}
              </div> 
              }
              {players.length === 0 ? <div></div> :
                <div className='players-container'>
                  <span>Players</span>
                  <table>
                    <tbody>
                      {players.map((addr, key) => {
                        let color;
                        let isYou = false;
                        if (playerColors) {
                          color = playerColors[addr];
                          isYou = addr === signer.address;
                        }

                        return (
                          <tr key={key} onClick={() => {
                            handlePlayerNameClick(addr)
                          }}>
                            <td>
                              <span
                                className="player-name"
                                style={ playerNameStyle(color) }
                              >
                                { addr.substring(0, 4) + '...' + addr.substring(addr.length - 4) }
                                {isYou ? '(you)' : '' } 
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              }
            </div>
            <BitRouletteModal />
          </div>
      }

      </div>
    }
    </div>
  );

}

export default GameScreen;
import { Room, Client } from "colyseus";
import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";
import { engine, world, createPlayer, moveBody, updatePhysics, matterToDefold, defoldToMatter, setBodyPosition } from "./physics";
import Matter from "matter-js";

// 물리 바디 정보를 담을 클래스
class PhysicsBody extends Schema {
  @type("string") label: string = "";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") width: number = 0;
  @type("number") height: number = 0;
  @type("number") radius: number = 0;
  @type("string") shape: string = "rectangle"; // "rectangle" 또는 "circle"
  @type("boolean") isStatic: boolean = false;
}

class Player extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("boolean") isControllable: boolean = true;
}

class State extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type([PhysicsBody]) debugBodies = new ArraySchema<PhysicsBody>();
}

export class MatterRoom extends Room<State> {
  // 디버그 모드 (true면 물리 바디 정보 전송)
  private debugPhysics: boolean = true;
  
  onCreate() {
    this.state = new State();
    
    this.onMessage("move", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (player) {
        const body = world.bodies.find(b => b.label === client.sessionId);
        if (body) {
          moveBody(body, data);
          const defoldPos = matterToDefold(body.position);
          player.x = defoldPos.x;
          player.y = defoldPos.y;
          player.isControllable = body.isControllable;
        }
      }
    });
    
    // 위치 동기화 메시지 처리
    this.onMessage("position_sync", (client, data) => {
      const player = this.state.players.get(client.sessionId);
      if (player) {
        const body = world.bodies.find(b => b.label === client.sessionId);
        if (body) {
          console.log(`위치 동기화 요청: ${data.x}, ${data.y} (클라이언트: ${client.sessionId})`);
          
          // Defold 좌표를 Matter 좌표로 변환
          const matterPos = defoldToMatter({ x: data.x, y: data.y });
          
          // 바디 위치 강제 설정
          setBodyPosition(body, matterPos);
          
          // 플레이어 스키마 업데이트
          player.x = data.x;
          player.y = data.y;
          
          // 속도 초기화
          Matter.Body.setVelocity(body, { x: 0, y: 0 });
          Matter.Body.setAngularVelocity(body, 0);
        }
      }
    });
    
    // 디버그 모드 토글 메시지 처리
    this.onMessage("toggle_debug", (client, data) => {
      this.debugPhysics = data.enabled;
      console.log(`디버그 모드 ${this.debugPhysics ? "활성화" : "비활성화"}`);
    });

    // 디버그 바디 요청 메시지 처리 - Schema 방식 대신 직접 메시지 교환
    this.onMessage("get_debug_bodies", (client, data) => {
      // 모든 물리 바디 정보 수집
      const bodyDataList: Array<{
        label: string;
        x: number;
        y: number;
        shape: string;
        radius: number;
        width: number;
        height: number;
        isStatic: boolean;
      }> = [];
      
      world.bodies.forEach(body => {
        // Defold 좌표계로 변환
        const defoldPos = matterToDefold(body.position);
        
        // 바디 정보 객체 생성
        const bodyData = {
          label: body.label,
          x: defoldPos.x,
          y: defoldPos.y,
          shape: body.circleRadius ? "circle" : "rectangle",
          radius: body.circleRadius || 0,
          width: body.bounds ? (body.bounds.max.x - body.bounds.min.x) : 0,
          height: body.bounds ? (body.bounds.max.y - body.bounds.min.y) : 0,
          isStatic: body.isStatic
        };
        
        bodyDataList.push(bodyData);
      });
      
      // 클라이언트에 바로 메시지로 응답
      client.send("debug_bodies_update", { bodies: bodyDataList });
      console.log(`디버그 바디 데이터 ${bodyDataList.length}개 전송`);
    });

    // Matter.js 주기적 업데이트 (60FPS로 제한)
    this.setSimulationInterval((deltaTime) => {
      updatePhysics(deltaTime);
      
      // 플레이어 상태 업데이트
      world.bodies.forEach((body) => {
        const player = this.state.players.get(body.label);
        if (player) {
          const defoldPos = matterToDefold(body.position);
          player.x = defoldPos.x;
          player.y = defoldPos.y;
          player.isControllable = body.isControllable;
        }
      });
      
      // 디버그 모드일 때 물리 바디 정보 업데이트
      if (this.debugPhysics) {
        this.updateDebugBodies();
      }
    }, 1000 / 60); // 60FPS로 고정
  }
  
  // 디버그용 물리 바디 정보 업데이트
  private updateDebugBodies() {
    // 기존 바디 정보 초기화
    this.state.debugBodies.clear();
    
    // 모든 물리 바디 정보 수집
    world.bodies.forEach(body => {
      const debugBody = new PhysicsBody();
      debugBody.label = body.label;
      
      // Defold 좌표계로 변환
      const defoldPos = matterToDefold(body.position);
      debugBody.x = defoldPos.x;
      debugBody.y = defoldPos.y;
      
      // 바디 타입 및 크기 정보
      if (body.circleRadius) {
        debugBody.shape = "circle";
        debugBody.radius = body.circleRadius;
      } else {
        debugBody.shape = "rectangle";
        // 바운딩 박스 크기 계산
        const bounds = body.bounds;
        debugBody.width = bounds.max.x - bounds.min.x;
        debugBody.height = bounds.max.y - bounds.min.y;
      }
      
      debugBody.isStatic = body.isStatic;
      
      // 상태에 추가
      this.state.debugBodies.push(debugBody);
    });
  }

  onJoin(client: Client) {
    const body = createPlayer(client.sessionId);
    const player = new Player();
    const defoldPos = matterToDefold(body.position);
    player.x = defoldPos.x;
    player.y = defoldPos.y;
    
    // 처음에는 제어 불가 상태로 설정
    body.isControllable = false;
    player.isControllable = false;
    
    this.state.players.set(client.sessionId, player);
    
    // 1초 후에 제어 가능 상태로 변경
    setTimeout(() => {
      if (this.state.players.has(client.sessionId)) {
        body.isControllable = true;
        player.isControllable = true;
      }
    }, 1000);
  }

  onLeave(client: Client) {
    const body = world.bodies.find(b => b.label === client.sessionId);
    if (body) {
      Matter.World.remove(world, body);
    }
    this.state.players.delete(client.sessionId);
  }
}


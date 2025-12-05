#!/usr/bin/env python3
"""
Simulate 25 users joining and triggering random notes for 5 seconds.
Run this while the conductor page is open with audio enabled.
"""

import asyncio
import random
import socketio

SERVER_URL = "http://localhost:8000"
NUM_USERS = 25
DURATION_SEC = 5
TRIGGER_INTERVAL_MS = 200  # Each user triggers every 200ms on average

INSTRUMENTS = ["pad", "synth", "lead"]
USERNAMES = [f"TestUser{i+1}" for i in range(NUM_USERS)]


async def simulate_user(user_id: int):
    """Simulate a single user joining and triggering notes."""
    sio = socketio.AsyncClient()
    username = USERNAMES[user_id]
    instrument = random.choice(INSTRUMENTS)
    octave = random.randint(-1, 1)
    
    try:
        await sio.connect(SERVER_URL, socketio_path="/ws/socket.io")
        print(f"✓ {username} connected (instrument: {instrument}, octave: {octave})")
        
        # Join as participant
        await sio.emit("crowd:join", {
            "role": "participant",
            "username": username,
            "instrument": instrument,
        })
        
        # Wait a bit for join to complete
        await asyncio.sleep(0.1)
        
        # Trigger notes for DURATION_SEC
        end_time = asyncio.get_event_loop().time() + DURATION_SEC
        trigger_count = 0
        
        while asyncio.get_event_loop().time() < end_time:
            # Generate random output (simulating digit recognition)
            output = [0.0] * 10
            # Activate 1-3 random digits
            num_active = random.randint(1, 3)
            for _ in range(num_active):
                digit = random.randint(0, 9)
                output[digit] = random.uniform(0.3, 0.95)
            
            # Occasionally change instrument
            if random.random() < 0.1:
                instrument = random.choice(INSTRUMENTS)
            
            # Trigger chord
            await sio.emit("chord:trigger", {
                "output": output,
                "instrument": instrument,
                "octave": octave,
            })
            trigger_count += 1
            
            # Random delay before next trigger (150-400ms)
            await asyncio.sleep(random.uniform(0.15, 0.4))
        
        print(f"  {username} triggered {trigger_count} chords")
        
    except Exception as e:
        print(f"✗ {username} error: {e}")
    finally:
        await sio.disconnect()


async def main():
    print(f"\n🎵 Simulating {NUM_USERS} users for {DURATION_SEC} seconds...")
    print(f"   Make sure conductor page is open with Audio ON!\n")
    
    # Give user time to prepare
    await asyncio.sleep(2)
    
    print("Starting simulation...\n")
    
    # Launch all users concurrently
    tasks = [simulate_user(i) for i in range(NUM_USERS)]
    await asyncio.gather(*tasks)
    
    print(f"\n✅ Simulation complete!")


if __name__ == "__main__":
    asyncio.run(main())


import './styles/main.css';
import { Game } from './core/Game';

declare global {
  interface Window {
    game?: Game;
  }
}

window.game = new Game();


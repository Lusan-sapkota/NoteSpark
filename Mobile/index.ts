import { registerRootComponent } from 'expo';

import App from './App';
import { registerWidgets } from './src/widget/widgets';

registerRootComponent(App);
registerWidgets();

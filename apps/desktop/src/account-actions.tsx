import {createContext} from 'react';
export const AccountActionsContext=createContext<{manage:()=>void;logout:()=>void;busy:boolean;error:string}|null>(null);

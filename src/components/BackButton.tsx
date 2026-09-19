// src/components/BackButton.tsx

import {
    useNavigate
} from "react-router-dom";


interface Props {

    to?: string;

}



export default function BackButton({

    to

}:Props){


const navigate = useNavigate();



return (

<button

onClick={()=>{

if(to){

navigate(to);

}

else{

navigate(-1);

}

}}

title="Back"

style={{

width:"38px",

height:"38px",

borderRadius:"50%",

border:"none",

background:"#ffffff",

color:"#007AFF",

fontSize:"26px",

fontWeight:"bold",

cursor:"pointer",

display:"flex",

alignItems:"center",

justifyContent:"center",

boxShadow:
"0 2px 8px rgba(0,0,0,.12)"

}}

>

‹

</button>

);

}

document.addEventListener("DOMContentLoaded", function() {
    console.log("DOM is ready!");
});
async function page_validate() {
    try {
        const response = await fetch('https://lwebber.ca/api/validate', { 
            method: 'GET', 
            credentials: 'include' // Crucial for sending cookies 
        });
        
        if (!response.ok) {
            return 'false';
        }
        else{
            return 'true';
        }
        const data = await response.json();
        console.log(data);
        if(data.valid != 'true'){
            return('false');
        }
    } catch (error) {
            console.log('Fetch failed:', error);
    }
}